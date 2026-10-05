import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Vergangene Wochen auf /plan (H-2) gegen eine isolierte SQLite-Datenbank: derselbe Weg wie die Seite
 * (resolveLedgerWeek -> getOrGenerateWeekPlan -> buildWeekLedger). Eine vergangene Woche wird nur
 * gelesen - gespeicherte Tage unverändert und mit Snapshot, fehlende Tage leer, nichts wird erzeugt,
 * Log-Einträge bleiben unberührt. "Heute" ist fest vorgegeben. prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-h2-history-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan } = await import("@/lib/generateMealPlan");
const { buildWeekLedger, resolveLedgerWeek } = await import("@/lib/weekLedger");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

/** Donnerstag, 01.10.2026. Die vergangene Woche im Test: Montag, 14.09., bis Sonntag, 20.09. */
const TODAY: CalendarDate = "2026-10-01";
const PAST_MONDAY: CalendarDate = "2026-09-14";
const PAST_WEEK = Array.from({ length: 7 }, (_, i) => addDays(PAST_MONDAY, i));

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
});

/** Profil mit gespeicherten Tagen, jeder so erzeugt, wie ein Request an genau diesem Tag ihn erzeugt hätte. */
async function profileWithStoredDays(days: CalendarDate[]) {
  const { profile } = await createPerson("A");
  const recipe = await createRecipe("Reis-Bowl");
  for (const day of days) await getOrGenerateDayPlan(profile.id, day, day);
  return { profileId: profile.id, recipe };
}

/** Wie /plan?week=<param>: Woche auflösen, laden, aufbereiten. */
async function viewWeek(profileId: string, weekParam: string) {
  const { weekStart, isCurrentWeek } = resolveLedgerWeek(weekParam, TODAY);
  const plans = await getOrGenerateWeekPlan(profileId, weekStart, TODAY);
  const ledger = buildWeekLedger({ weekStart, plans: plans.map((plan) => plan ?? { items: [] }), today: TODAY });
  return { weekStart, isCurrentWeek, plans, ledger };
}

function storedRows(profileId: string) {
  return prisma.mealPlanDay.findMany({ where: { profileId }, include: { items: true }, orderBy: { date: "asc" } });
}

describe("/plan?week=: vergangene Woche lesen (H-2)", () => {
  it("eine vollständig gespeicherte Woche kommt unverändert, mit Name und Kalorien wie geplant (Snapshot)", async () => {
    const { profileId, recipe } = await profileWithStoredDays(PAST_WEEK);
    const before = await storedRows(profileId);
    // Das Rezept ändert sich später im Katalog - die Woche zeigt weiter, was damals geplant war.
    await prisma.recipe.update({ where: { id: recipe.id }, data: { name: "Reis-Bowl Deluxe", kcal: 999 } });

    const { weekStart, isCurrentWeek, plans, ledger } = await viewWeek(profileId, "2026-09-17");

    expect({ weekStart, isCurrentWeek }).toEqual({ weekStart: PAST_MONDAY, isCurrentWeek: false });
    expect(plans.map((plan) => plan?.id)).toEqual(before.map((day) => day.id));
    for (const day of ledger.days) {
      expect(day.isHistorical).toBe(true);
      expect(day.meals.map((meal) => meal.name)).toEqual(["Reis-Bowl"]);
      expect(day.meals[0].plannedRecipe.kcal).toBe(450);
    }
    expect(await storedRows(profileId)).toEqual(before);
  });

  it("eine teilweise gespeicherte Woche zeigt fehlende Tage leer und legt keinen Tag an", async () => {
    const { profileId } = await profileWithStoredDays([PAST_WEEK[0], PAST_WEEK[2]]);
    const before = await storedRows(profileId);

    const { plans, ledger } = await viewWeek(profileId, PAST_MONDAY);

    expect(plans.map((plan) => plan !== null)).toEqual([true, false, true, false, false, false, false]);
    expect(ledger.days.map((day) => day.meals.length > 0)).toEqual([true, false, true, false, false, false, false]);
    expect(await storedRows(profileId)).toEqual(before);
    expect(await prisma.mealPlanItem.count()).toBe(2);
  });

  it("eine Woche ganz ohne Pläne (beliebig weit zurück) bleibt leer, nichts wird erzeugt", async () => {
    const { profileId } = await profileWithStoredDays([]);

    const { plans, ledger } = await viewWeek(profileId, "2025-03-05");

    expect(plans).toEqual([null, null, null, null, null, null, null]);
    expect(ledger.days.every((day) => day.meals.length === 0 && day.isHistorical)).toBe(true);
    expect(await prisma.mealPlanDay.count()).toBe(0);
  });

  it("Log-Einträge der Woche bleiben unverändert und erscheinen nicht im Plan", async () => {
    const { profileId, recipe } = await profileWithStoredDays([PAST_WEEK[0]]);
    await prisma.logEntry.create({
      data: { profileId, date: toDbDate(PAST_WEEK[1]), slot: "LUNCH", recipeId: recipe.id, customName: "Gegessen", kcal: 612, proteinG: 30, carbsG: 60, fatG: 20 },
    });
    const logsBefore = await prisma.logEntry.findMany({ where: { profileId } });

    const { ledger } = await viewWeek(profileId, PAST_MONDAY);

    expect(ledger.days[1].meals).toEqual([]);
    expect(await prisma.logEntry.findMany({ where: { profileId } })).toEqual(logsBefore);
  });

  it("ein Datum in der Zukunft zeigt die laufende Woche - die nächste Woche wird dadurch nicht erzeugt", async () => {
    const { profileId } = await profileWithStoredDays([]);

    const { weekStart, isCurrentWeek } = await viewWeek(profileId, "2026-10-07");

    expect({ weekStart, isCurrentWeek }).toEqual({ weekStart: "2026-09-28", isCurrentWeek: true });
    const stored = await prisma.mealPlanDay.findMany({ where: { profileId }, select: { date: true } });
    expect(stored.every(({ date }) => date < toDbDate("2026-10-05"))).toBe(true);
  });
});
