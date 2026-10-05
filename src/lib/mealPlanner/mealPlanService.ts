import type { MealPlan, MealPlanStatus, Prisma } from "@prisma/client";
import { fromDbDate, toDbDate, type CalendarDate } from "../calendarDate";
import { prisma } from "../db";
import { isHistoricalPlanDay } from "../planDayBoundary";
import { isAllowedStatusTransition, overlappingPeriod } from "./planLifecycle";
import type { GeneratedMeal, MealPlanGenerationStatus } from "./types";

/**
 * Wie pantryService.ts/budgetService.ts/householdService.ts: JEDE Funktion
 * filtert nach `householdId` (nie nach `id` allein), eine fremde/erratene ID
 * führt konsequent zu "nicht gefunden".
 */

export function listMealPlans(householdId: string) {
  return prisma.mealPlan.findMany({
    where: { householdId },
    orderBy: { startDate: "desc" },
    include: { _count: { select: { meals: true, members: true } } },
  });
}

const PLAN_DETAIL_INCLUDE = {
  members: { include: { householdMember: { include: { user: { select: { id: true, name: true } } } } } },
  meals: { include: { recipe: true }, orderBy: [{ date: "asc" }, { slot: "asc" }] },
} satisfies Prisma.MealPlanInclude;

export function getMealPlan(householdId: string, id: string) {
  return prisma.mealPlan.findFirst({ where: { id, householdId }, include: PLAN_DETAIL_INCLUDE });
}

export interface CreateMealPlanInput {
  name?: string;
  /** Erster und letzter Kalendertag des Plans (einschließlich), siehe src/lib/calendarDate.ts. */
  startDate: CalendarDate;
  endDate: CalendarDate;
  householdMemberIds: string[];
  meals: GeneratedMeal[];
  /** DRAFT bei PARTIAL/NO_VALID_PLAN-Ergebnissen, ACTIVE sonst - vom Aufrufer (Route) entschieden, siehe Abschnitt 20. */
  status: "DRAFT" | "ACTIVE";
}

/**
 * Sperrt den Haushalt für die laufende Transaktion, bevor Status gelesen und geschrieben werden. Unter
 * SQLite laufen schreibende Transaktionen ohnehin nacheinander; die Sperre ist für PostgreSQL gedacht,
 * wo sie als Zeilensperre parallele Aktivierungen desselben Haushalts serialisiert. Gegen PostgreSQL
 * ist das noch nicht getestet (siehe src/test/mealPlanLifecycle.test.ts). Nebenwirkung: Household.updatedAt.
 */
async function lockHousehold(tx: Prisma.TransactionClient, householdId: string) {
  await tx.household.update({ where: { id: householdId }, data: { updatedAt: new Date() } });
}

/** Archiviert die ACTIVE-Pläne des Haushalts, deren Zeitraum sich mit dem gegebenen überschneidet (planLifecycle.ts). */
async function archiveOverlappingActivePlans(
  tx: Prisma.TransactionClient,
  householdId: string,
  period: { startDate: Date; endDate: Date },
  exceptPlanId?: string,
): Promise<string[]> {
  const overlapping = await tx.mealPlan.findMany({
    where: {
      householdId,
      status: "ACTIVE",
      ...overlappingPeriod(period.startDate, period.endDate),
      ...(exceptPlanId ? { id: { not: exceptPlanId } } : {}),
    },
    select: { id: true },
  });
  const ids = overlapping.map((plan) => plan.id);
  if (ids.length > 0) await tx.mealPlan.updateMany({ where: { id: { in: ids } }, data: { status: "ARCHIVED" } });
  return ids;
}

/**
 * Persistiert einen bereits generierten UND validierten Plan (siehe plannerEngine.ts/validatePlan.ts):
 * MealPlan + MealPlanMember-Zeilen + alle MealPlanMeal-Zeilen als verschachtelter `create`.
 *
 * Ein ACTIVE erzeugter Plan durchläuft dieselbe Aktivierung wie ein später aktivierter Entwurf: In einer
 * Transaktion werden die überschneidenden ACTIVE-Pläne des Haushalts archiviert (planLifecycle.ts).
 * `archivedPlanIds` nennt sie, damit die Oberfläche ihren Status nachziehen kann.
 */
export async function createMealPlan(householdId: string, input: CreateMealPlanInput) {
  const data = {
    householdId,
    name: input.name,
    startDate: toDbDate(input.startDate),
    endDate: toDbDate(input.endDate),
    status: input.status,
    members: { create: input.householdMemberIds.map((householdMemberId) => ({ householdMemberId })) },
    meals: {
      create: input.meals.map((meal) => ({
        date: toDbDate(meal.date),
        slot: meal.slot,
        recipeId: meal.recipeId,
        portionMultiplier: meal.portionMultiplier,
        reasons: JSON.stringify(meal.reasons),
        recipeName: meal.recipeName,
        recipeKcal: meal.recipeKcal,
        recipeProteinG: meal.recipeProteinG,
        recipeCarbsG: meal.recipeCarbsG,
        recipeFatG: meal.recipeFatG,
      })),
    },
  } satisfies Prisma.MealPlanUncheckedCreateInput;

  if (input.status === "DRAFT") {
    return { plan: await prisma.mealPlan.create({ data, include: PLAN_DETAIL_INCLUDE }), archivedPlanIds: [] };
  }
  return prisma.$transaction(async (tx) => {
    await lockHousehold(tx, householdId);
    const archivedPlanIds = await archiveOverlappingActivePlans(tx, householdId, data);
    const plan = await tx.mealPlan.create({ data, include: PLAN_DETAIL_INCLUDE });
    return { plan, archivedPlanIds };
  });
}

export interface UpdateMealPlanInput {
  name?: string;
  status?: MealPlanStatus;
}

export type MealPlanUpdateError =
  /** Kein Plan dieses Haushalts mit dieser ID. */
  | "NOT_FOUND"
  /** Übergang nicht erlaubt (planLifecycle.ts) oder der Status hat sich inzwischen geändert. */
  | "INVALID_TRANSITION"
  /** Ein ganz vergangener Entwurf wird nicht mehr nachträglich übernommen (DRAFT → ACTIVE, R5E). */
  | "HISTORICAL_PLAN";

export type MealPlanUpdateResult = { ok: true; plan: MealPlan; archivedPlanIds: string[] } | { ok: false; error: MealPlanUpdateError };

/**
 * Ändert Name und/oder Status. Ein Statuswechsel folgt planLifecycle.ts; ein Entwurf, dessen Zeitraum
 * ganz vor `today` (todayForUser des Aufrufers) liegt, wird nicht mehr aktiviert. Archivieren und
 * Umbenennen sind unabhängig vom Datum erlaubt - beides ändert nie die geplanten Mahlzeiten. Eine
 * Aktivierung archiviert in derselben Transaktion die überschneidenden ACTIVE-Pläne, auch vergangene.
 */
export async function updateMealPlan(householdId: string, id: string, input: UpdateMealPlanInput, today: CalendarDate): Promise<MealPlanUpdateResult> {
  const existing = await prisma.mealPlan.findFirst({ where: { id, householdId } });
  if (!existing) return { ok: false, error: "NOT_FOUND" };

  const nameChange = input.name !== undefined ? { name: input.name } : {};
  if (input.status === undefined || input.status === existing.status) {
    return { ok: true, plan: await prisma.mealPlan.update({ where: { id }, data: nameChange }), archivedPlanIds: [] };
  }
  if (!isAllowedStatusTransition(existing.status, input.status)) return { ok: false, error: "INVALID_TRANSITION" };
  if (input.status === "ACTIVE" && isHistoricalPlanDay(fromDbDate(existing.endDate), today)) return { ok: false, error: "HISTORICAL_PLAN" };

  return changeStatus(existing, input.status, nameChange);
}

/** Der eigentliche Statuswechsel, atomar und nur, wenn der Plan noch den gelesenen Status hat. */
async function changeStatus(existing: MealPlan, to: MealPlanStatus, nameChange: { name?: string }): Promise<MealPlanUpdateResult> {
  return prisma.$transaction(async (tx) => {
    await lockHousehold(tx, existing.householdId);
    const changed = await tx.mealPlan.updateMany({
      where: { id: existing.id, householdId: existing.householdId, status: existing.status },
      data: { status: to, ...nameChange },
    });
    if (changed.count === 0) return { ok: false, error: "INVALID_TRANSITION" };

    const archivedPlanIds = to === "ACTIVE" ? await archiveOverlappingActivePlans(tx, existing.householdId, existing, existing.id) : [];
    return { ok: true, plan: await tx.mealPlan.findUniqueOrThrow({ where: { id: existing.id } }), archivedPlanIds };
  });
}

export type MealPlanDeleteResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "NOT_DELETABLE" };

/**
 * Gelöscht wird nur ein Entwurf, der heute oder später beginnt (`today` = todayForUser des Aufrufers).
 * Aktive und archivierte Pläne sowie Pläne mit vergangenen Tagen bleiben als Historie erhalten (R5E).
 */
export async function deleteMealPlan(householdId: string, id: string, today: CalendarDate): Promise<MealPlanDeleteResult> {
  const deleted = await prisma.mealPlan.deleteMany({ where: { id, householdId, status: "DRAFT", startDate: { gte: toDbDate(today) } } });
  if (deleted.count > 0) return { ok: true };
  const exists = await prisma.mealPlan.findFirst({ where: { id, householdId }, select: { id: true } });
  return { ok: false, error: exists ? "NOT_DELETABLE" : "NOT_FOUND" };
}

export type { MealPlanGenerationStatus };
