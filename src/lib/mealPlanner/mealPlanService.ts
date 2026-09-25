import { toDbDate, type CalendarDate } from "../calendarDate";
import { prisma } from "../db";
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

export function getMealPlan(householdId: string, id: string) {
  return prisma.mealPlan.findFirst({
    where: { id, householdId },
    include: {
      members: { include: { householdMember: { include: { user: { select: { id: true, name: true } } } } } },
      meals: { include: { recipe: true }, orderBy: [{ date: "asc" }, { slot: "asc" }] },
    },
  });
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
 * Persistiert einen bereits generierten UND validierten Plan (siehe
 * plannerEngine.ts/validatePlan.ts): MealPlan + MealPlanMember-Zeilen + alle
 * MealPlanMeal-Zeilen als verschachtelter `create`. Prisma führt verschachtelte
 * Schreibvorgänge innerhalb EINES `create()`-Aufrufs bereits atomar aus (eigene
 * implizite Transaktion) - ein zusätzliches explizites `$transaction(...)`
 * darum wäre unnötige Komplexität für denselben Effekt.
 */
export async function createMealPlan(householdId: string, input: CreateMealPlanInput) {
  return prisma.mealPlan.create({
    data: {
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
        })),
      },
    },
    include: {
      members: { include: { householdMember: { include: { user: { select: { id: true, name: true } } } } } },
      meals: { include: { recipe: true }, orderBy: [{ date: "asc" }, { slot: "asc" }] },
    },
  });
}

export interface UpdateMealPlanInput {
  name?: string;
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export async function updateMealPlan(householdId: string, id: string, input: UpdateMealPlanInput) {
  const existing = await prisma.mealPlan.findFirst({ where: { id, householdId } });
  if (!existing) return null;
  return prisma.mealPlan.update({
    where: { id },
    data: { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.status !== undefined ? { status: input.status } : {}) },
  });
}

export async function deleteMealPlan(householdId: string, id: string): Promise<boolean> {
  const result = await prisma.mealPlan.deleteMany({ where: { id, householdId } });
  return result.count > 0;
}

export type { MealPlanGenerationStatus };
