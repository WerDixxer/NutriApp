import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * R5F-11: Die für alle Tage gleichen Planungsdaten (Planer-Sicht des Profils, Rezepte, Food-Katalog,
 * strukturierte Zutaten) lädt eine Planungsoperation einmal statt je Tag. Beobachtet über das
 * Query-Log von Prisma gegen eine isolierte SQLite-Datenbank - prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f11-loads-");
});
const queryLog = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const client = new PrismaClient({ datasourceUrl: db.url, log: [{ emit: "event", level: "query" }] });
  client.$on("query", (event) => queryLog.queries.push(event.query));
  return { prisma: client };
});

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan, regenerateEditableDays } = await import("@/lib/generateMealPlan");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

/** Montag; die ganze Woche ist bearbeitbar. */
const MONDAY: CalendarDate = "2026-09-21";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
});

/** Profil mit Allergie, Liebling und Abneigung (dann werden auch Katalog und strukturierte Zutaten geladen). */
async function personWithPreferences() {
  const { profile } = await createPerson("A");
  await prisma.profileTag.createMany({
    data: [
      { label: "Erdnüsse", allergyOfProfileId: profile.id },
      { label: "Reis", likedByProfileId: profile.id },
      { label: "Pilze", dislikedByProfileId: profile.id },
    ],
  });
  for (const name of ["Bowl A", "Bowl B", "Bowl C"]) await createRecipe(name);
  return profile.id;
}

/** Wie oft während `run` aus den Tabellen gelesen wurde, die die gemeinsamen Planungsdaten liefern. */
async function readsDuring(run: () => Promise<unknown>) {
  queryLog.queries = [];
  await run();
  const readsFrom = (table: string) => queryLog.queries.filter((q) => q.startsWith("SELECT") && q.includes(`FROM \`main\`.\`${table}\``));
  return {
    profile: readsFrom("Profile").length,
    // Der Kandidatenpool (Katalog- und eigene Rezepte); die Rezepte gespeicherter Tage werden je Tag per ID gelesen.
    candidatePool: readsFrom("Recipe").filter((q) => q.split("WHERE")[1]?.includes("ownerProfileId")).length,
    catalog: readsFrom("Ingredient").length,
    structuredIngredients: readsFrom("RecipeIngredient").length,
  };
}

describe("gemeinsame Planungsdaten werden je Operation einmal geladen (R5F-11)", () => {
  it("eine Woche mit sieben neuen Tagen lädt Profil, Rezepte, Katalog und strukturierte Zutaten je einmal", async () => {
    const profileId = await personWithPreferences();

    const reads = await readsDuring(() => getOrGenerateWeekPlan(profileId, MONDAY, MONDAY));

    expect(await prisma.mealPlanDay.count({ where: { profileId } })).toBe(7);
    expect(reads).toEqual({ profile: 1, candidatePool: 1, catalog: 1, structuredIngredients: 1 });
  });

  it("ein einzelner Tag lädt sie ebenfalls genau einmal", async () => {
    const profileId = await personWithPreferences();

    const reads = await readsDuring(() => getOrGenerateDayPlan(profileId, MONDAY, MONDAY));

    expect(reads).toEqual({ profile: 1, candidatePool: 1, catalog: 1, structuredIngredients: 1 });
  });

  it("eine Woche aus lauter gespeicherten Tagen lädt sie gar nicht", async () => {
    const profileId = await personWithPreferences();
    await getOrGenerateWeekPlan(profileId, MONDAY, MONDAY);

    const reads = await readsDuring(() => getOrGenerateWeekPlan(profileId, MONDAY, MONDAY));

    expect(reads).toEqual({ profile: 0, candidatePool: 0, catalog: 0, structuredIngredients: 0 });
  });

  it("die Neuplanung mehrerer gespeicherter Tage lädt sie einmal", async () => {
    const profileId = await personWithPreferences();
    for (const offset of [0, 1, 2, 9]) {
      const day = addDays(MONDAY, offset);
      await getOrGenerateDayPlan(profileId, day, day);
    }
    expect(await prisma.mealPlanDay.count({ where: { profileId, date: { gte: toDbDate(MONDAY) } } })).toBe(4);

    const reads = await readsDuring(() => regenerateEditableDays(profileId, MONDAY));

    expect(reads).toEqual({ profile: 1, candidatePool: 1, catalog: 1, structuredIngredients: 1 });
  });
});
