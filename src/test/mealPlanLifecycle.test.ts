import type { MealPlanStatus } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Lebenszyklus der Haushaltspläne (R5F-5) gegen eine isolierte SQLite-Datenbank: DRAFT → ACTIVE →
 * ARCHIVED, höchstens ein ACTIVE-Plan je Haushalt und überschneidendem Zeitraum, atomare Aktivierung.
 * "Heute" wird ausdrücklich übergeben. prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f5-lifecycle-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { createMealPlan, deleteMealPlan, updateMealPlan } = await import("@/lib/mealPlanner/mealPlanService");
const { createPerson, createRecipe, createHousehold, clearFixtureData } = databaseFixtures(prisma);

const TODAY: CalendarDate = "2026-10-01";
const WEEK_A = { startDate: "2026-10-05", endDate: "2026-10-11" } as const;
const WEEK_A_SHIFTED = { startDate: "2026-10-08", endDate: "2026-10-14" } as const; // überschneidet WEEK_A
const WEEK_B = { startDate: "2026-10-12", endDate: "2026-10-18" } as const; // grenzt an WEEK_A, keine Überschneidung
const LAST_WEEK = { startDate: "2026-09-21", endDate: "2026-09-27" } as const; // ganz in der Vergangenheit

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r5f5_fail_archive`);
  await clearFixtureData();
});

async function household(name = "A") {
  const { user } = await createPerson(name);
  const created = await createHousehold(user.id);
  const recipe = await createRecipe(`Reis-Bowl ${name}`);
  return { householdId: created.id, recipeId: recipe.id };
}

/** Ein Plan über `period` mit einer Mahlzeit, direkt über den Service erzeugt (wie bei der Generierung). */
async function plan(
  ctx: { householdId: string; recipeId: string },
  period: { startDate: CalendarDate; endDate: CalendarDate },
  status: "DRAFT" | "ACTIVE",
) {
  const { plan } = await createMealPlan(ctx.householdId, {
    ...period,
    householdMemberIds: [],
    meals: [
      {
        date: period.startDate,
        slot: "LUNCH",
        recipeId: ctx.recipeId,
        recipeName: "Reis-Bowl",
        recipeKcal: 450,
        recipeProteinG: 25,
        recipeCarbsG: 50,
        recipeFatG: 12,
        portionMultiplier: 1,
        reasons: [],
      },
    ],
    status,
  });
  return plan.id;
}

async function statusOf(id: string): Promise<MealPlanStatus | undefined> {
  return (await prisma.mealPlan.findUnique({ where: { id } }))?.status;
}

/** Die gespeicherten Mahlzeiten eines Plans samt Snapshot - zum Vergleich vor/nach Lebenszyklus-Änderungen. */
function mealsOf(planId: string) {
  return prisma.mealPlanMeal.findMany({ where: { mealPlanId: planId }, orderBy: { id: "asc" } });
}

async function activePlanIds(householdId: string): Promise<string[]> {
  const plans = await prisma.mealPlan.findMany({ where: { householdId, status: "ACTIVE" }, select: { id: true }, orderBy: { id: "asc" } });
  return plans.map((p) => p.id);
}

describe("Statusübergänge (R5F-5)", () => {
  it("DRAFT → ACTIVE und ACTIVE → ARCHIVED", async () => {
    const ctx = await household();
    const id = await plan(ctx, WEEK_A, "DRAFT");

    expect(await updateMealPlan(ctx.householdId, id, { status: "ACTIVE" }, TODAY)).toMatchObject({ ok: true, plan: { status: "ACTIVE" } });
    expect(await updateMealPlan(ctx.householdId, id, { status: "ARCHIVED" }, TODAY)).toMatchObject({ ok: true, plan: { status: "ARCHIVED" } });
    expect(await statusOf(id)).toBe("ARCHIVED");
  });

  it.each([
    ["DRAFT", "ARCHIVED"],
    ["ACTIVE", "DRAFT"],
    ["ARCHIVED", "ACTIVE"],
    ["ARCHIVED", "DRAFT"],
  ] as const)("lehnt %s → %s ab und lässt den Plan unverändert", async (from, to) => {
    const ctx = await household();
    const id = await plan(ctx, WEEK_A, from === "DRAFT" ? "DRAFT" : "ACTIVE");
    if (from === "ARCHIVED") await updateMealPlan(ctx.householdId, id, { status: "ARCHIVED" }, TODAY);

    expect(await updateMealPlan(ctx.householdId, id, { status: to }, TODAY)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await statusOf(id)).toBe(from);
  });

});

describe("Vergangene Pläne (R5F-5)", () => {
  it("ein ganz vergangener Entwurf wird nicht mehr aktiviert; seine Mahlzeiten bleiben unverändert", async () => {
    const ctx = await household();
    const draft = await plan(ctx, LAST_WEEK, "DRAFT");
    const mealsBefore = await mealsOf(draft);

    expect(await updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY)).toEqual({ ok: false, error: "HISTORICAL_PLAN" });

    expect(await statusOf(draft)).toBe("DRAFT");
    expect(await mealsOf(draft)).toEqual(mealsBefore);
  });

  it("ein vergangener aktiver Plan lässt sich archivieren; Mahlzeiten und Snapshots bleiben unverändert", async () => {
    const ctx = await household();
    const pastActive = await plan(ctx, LAST_WEEK, "ACTIVE");
    const mealsBefore = await mealsOf(pastActive);

    expect(await updateMealPlan(ctx.householdId, pastActive, { status: "ARCHIVED" }, TODAY)).toMatchObject({ ok: true, plan: { status: "ARCHIVED" } });

    expect(await mealsOf(pastActive)).toEqual(mealsBefore);
    expect(mealsBefore[0]).toMatchObject({ recipeName: "Reis-Bowl", recipeKcal: 450 });
  });

  it("die Aktivierung eines Plans, der heute umfasst, archiviert auch einen überschneidenden vergangenen aktiven Plan", async () => {
    const ctx = await household();
    const pastActive = await plan(ctx, { startDate: "2026-09-24", endDate: "2026-09-30" }, "ACTIVE"); // endet gestern
    const draft = await plan(ctx, { startDate: "2026-09-29", endDate: "2026-10-05" }, "DRAFT"); // umfasst heute
    const mealsBefore = await mealsOf(pastActive);

    const result = await updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY);

    expect(result).toMatchObject({ ok: true, archivedPlanIds: [pastActive] });
    expect(await statusOf(pastActive)).toBe("ARCHIVED");
    expect(await activePlanIds(ctx.householdId)).toEqual([draft]);
    expect(await mealsOf(pastActive)).toEqual(mealsBefore);
  });

  it.each([
    ["ACTIVE", "ACTIVE"],
    ["ARCHIVED", "ARCHIVED"],
  ] as const)("ein vergangener Plan (%s) lässt sich umbenennen, ohne dass sich Status oder Mahlzeiten ändern", async (_label, status) => {
    const ctx = await household();
    const pastPlan = await plan(ctx, LAST_WEEK, "ACTIVE");
    if (status === "ARCHIVED") await updateMealPlan(ctx.householdId, pastPlan, { status: "ARCHIVED" }, TODAY);
    const mealsBefore = await mealsOf(pastPlan);

    expect(await updateMealPlan(ctx.householdId, pastPlan, { name: "Urlaubswoche" }, TODAY)).toMatchObject({
      ok: true,
      plan: { name: "Urlaubswoche", status },
    });
    expect(await mealsOf(pastPlan)).toEqual(mealsBefore);
  });
});

describe("Löschen: nur Entwürfe, die heute oder später beginnen (R5F-5)", () => {
  const TODAY_WEEK = { startDate: TODAY, endDate: "2026-10-07" } as const;
  const SINCE_YESTERDAY = { startDate: "2026-09-30", endDate: "2026-10-06" } as const;

  it.each([
    ["ein heutiger Entwurf", TODAY_WEEK],
    ["ein künftiger Entwurf", WEEK_A],
  ] as const)("%s lässt sich löschen", async (_label, period) => {
    const ctx = await household();
    const draft = await plan(ctx, period, "DRAFT");

    expect(await deleteMealPlan(ctx.householdId, draft, TODAY)).toEqual({ ok: true });
    expect(await statusOf(draft)).toBeUndefined();
  });

  it.each([
    ["ein vergangener Entwurf", LAST_WEEK, "DRAFT"],
    ["ein Entwurf, der gestern begann", SINCE_YESTERDAY, "DRAFT"],
    ["ein künftiger aktiver Plan", WEEK_A, "ACTIVE"],
    ["ein vergangener aktiver Plan", LAST_WEEK, "ACTIVE"],
    ["ein künftiger archivierter Plan", WEEK_A, "ARCHIVED"],
  ] as const)("%s lässt sich nicht löschen und bleibt samt Mahlzeiten erhalten", async (_label, period, status) => {
    const ctx = await household();
    const id = await plan(ctx, period, status === "DRAFT" ? "DRAFT" : "ACTIVE");
    if (status === "ARCHIVED") await updateMealPlan(ctx.householdId, id, { status: "ARCHIVED" }, TODAY);
    const mealsBefore = await mealsOf(id);

    expect(await deleteMealPlan(ctx.householdId, id, TODAY)).toEqual({ ok: false, error: "NOT_DELETABLE" });

    expect(await statusOf(id)).toBe(status);
    expect(await mealsOf(id)).toEqual(mealsBefore);
  });
});

describe("Höchstens ein ACTIVE-Plan je Haushalt und Zeitraum (R5F-5)", () => {
  it("die Aktivierung eines Entwurfs archiviert den überschneidenden aktiven Plan", async () => {
    const ctx = await household();
    const old = await plan(ctx, WEEK_A, "ACTIVE");
    const draft = await plan(ctx, WEEK_A_SHIFTED, "DRAFT");

    const result = await updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY);

    expect(result).toMatchObject({ ok: true, archivedPlanIds: [old] });
    expect(await activePlanIds(ctx.householdId)).toEqual([draft]);
    expect(await statusOf(old)).toBe("ARCHIVED");
  });

  it("eine aktiv erzeugte Planung (Generierung) archiviert ebenso den überschneidenden aktiven Plan", async () => {
    const ctx = await household();
    const old = await plan(ctx, WEEK_A, "ACTIVE");

    const { plan: created, archivedPlanIds } = await createMealPlan(ctx.householdId, {
      ...WEEK_A_SHIFTED,
      householdMemberIds: [],
      meals: [],
      status: "ACTIVE",
    });

    expect(archivedPlanIds).toEqual([old]);
    expect(await activePlanIds(ctx.householdId)).toEqual([created.id]);
  });

  it("aktive Pläne für Zeiträume ohne Überschneidung bleiben nebeneinander bestehen", async () => {
    const ctx = await household();
    const weekA = await plan(ctx, WEEK_A, "ACTIVE");
    const weekB = await plan(ctx, WEEK_B, "DRAFT");

    expect(await updateMealPlan(ctx.householdId, weekB, { status: "ACTIVE" }, TODAY)).toMatchObject({ ok: true, archivedPlanIds: [] });
    expect(await activePlanIds(ctx.householdId)).toEqual([weekA, weekB].sort());
  });

  it("ein anderer Haushalt bleibt unberührt", async () => {
    const a = await household("A");
    const b = await household("B");
    const activeOfB = await plan(b, WEEK_A, "ACTIVE");
    const draftOfA = await plan(a, WEEK_A, "DRAFT");

    await updateMealPlan(a.householdId, draftOfA, { status: "ACTIVE" }, TODAY);

    expect(await statusOf(activeOfB)).toBe("ACTIVE");
    expect(await activePlanIds(b.householdId)).toEqual([activeOfB]);
  });

  it("ein Haushalt kann den Plan eines anderen nicht ändern (NOT_FOUND, nichts geschrieben)", async () => {
    const a = await household("A");
    const b = await household("B");
    const draftOfA = await plan(a, WEEK_A, "DRAFT");

    expect(await updateMealPlan(b.householdId, draftOfA, { status: "ACTIVE" }, TODAY)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await deleteMealPlan(b.householdId, draftOfA, TODAY)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await statusOf(draftOfA)).toBe("DRAFT");
  });

  it("vorhandene überschneidende ACTIVE-Pläne (Altdaten) werden erst bei einer neuen Aktivierung archiviert", async () => {
    const ctx = await household();
    const period = { householdId: ctx.householdId, startDate: toDbDate(WEEK_A.startDate), endDate: toDbDate(WEEK_A.endDate), status: "ACTIVE" as const };
    const legacy1 = await prisma.mealPlan.create({ data: period });
    const legacy2 = await prisma.mealPlan.create({ data: period });
    const draft = await plan(ctx, WEEK_A_SHIFTED, "DRAFT");

    const result = await updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY);

    expect(result.ok && [...result.archivedPlanIds].sort()).toEqual([legacy1.id, legacy2.id].sort());
    expect(await activePlanIds(ctx.householdId)).toEqual([draft]);
  });
});

describe("Atomare Aktivierung (R5F-5)", () => {
  it("scheitert das Archivieren, bleibt alles wie vorher: Entwurf bleibt DRAFT, der alte Plan ACTIVE", async () => {
    const ctx = await household();
    const old = await plan(ctx, WEEK_A, "ACTIVE");
    const draft = await plan(ctx, WEEK_A_SHIFTED, "DRAFT");
    // Ein echter DB-Fehler mitten in der Transaktion: Archivieren schlägt in DIESER Testdatenbank fehl.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5f5_fail_archive BEFORE UPDATE ON "MealPlan" WHEN NEW."status" = 'ARCHIVED' BEGIN SELECT RAISE(ABORT, 'R5F-5 injected failure'); END;`,
    );

    await expect(updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY)).rejects.toThrow();

    expect([await statusOf(draft), await statusOf(old)]).toEqual(["DRAFT", "ACTIVE"]);
  });

  /**
   * Was das unter SQLite belegt: Gleichzeitige Aktivierungen enden konsistent (genau ein ACTIVE-Plan).
   * Was es NICHT belegt: die Haushaltssperre in mealPlanService.ts - SQLite führt schreibende
   * Transaktionen ohnehin nacheinander aus, der Test bleibt auch ohne Sperre grün. Die Sperre zählt erst
   * unter PostgreSQL; dort muss dieser Test erneut laufen.
   */
  it("zwei gleichzeitige Aktivierungen überschneidender Entwürfe enden mit genau einem aktiven Plan", async () => {
    const ctx = await household();
    const first = await plan(ctx, WEEK_A, "DRAFT");
    const second = await plan(ctx, WEEK_A_SHIFTED, "DRAFT");

    const results = await Promise.allSettled([
      updateMealPlan(ctx.householdId, first, { status: "ACTIVE" }, TODAY),
      updateMealPlan(ctx.householdId, second, { status: "ACTIVE" }, TODAY),
    ]);

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const active = await activePlanIds(ctx.householdId);
    expect(active).toHaveLength(1);
    const archived = active[0] === first ? second : first;
    expect(await statusOf(archived)).toBe("ARCHIVED");
  });

  it("derselbe Entwurf zweimal gleichzeitig aktiviert: genau eine Aktivierung greift, die andere wird abgelehnt", async () => {
    const ctx = await household();
    const draft = await plan(ctx, WEEK_A, "DRAFT");

    const [a, b] = await Promise.all([
      updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY),
      updateMealPlan(ctx.householdId, draft, { status: "ACTIVE" }, TODAY),
    ]);

    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await activePlanIds(ctx.householdId)).toEqual([draft]);
  });
});
