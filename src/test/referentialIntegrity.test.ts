import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { toDbDate } from "@/lib/calendarDate";
import { databaseFixtures, PLAN_DATE, RECIPE_NUTRITION } from "./databaseFixtures";
import { createIsolatedDatabaseLocation, pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Referentielle Integrität des aktuellen Schemas gegen eine echte, isolierte SQLite-Datenbank (R4A).
 * Die Tests halten den IST-Zustand der onDelete-Regeln aus prisma/schema.prisma fest, keine
 * gewünschte Soll-Semantik: Ändert ein späterer Block eine Regel (z.B. F-09 oder ein
 * Account-Löschkonzept), schlägt hier bewusst ein Test fehl und wird mit angepasst.
 * Alle Fehler kommen von der Datenbank selbst, nichts ist gemockt. prisma/dev.db wird nie geöffnet.
 */
const db = createIsolatedDatabaseLocation("vyn-r4a-integrity-");
const prisma = new PrismaClient({ datasourceUrl: db.url });
const { createPerson, createRecipe, createHousehold, planInDayPlan, planInHouseholdPlan, clearFixtureData } = databaseFixtures(prisma);

/** So meldet Prisma einen Verweis, den SQLite per Foreign Key ablehnt ("FOREIGN KEY constraint failed"). */
const FOREIGN_KEY_VIOLATION = { name: "PrismaClientKnownRequestError", code: "P2003" };

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(() => clearFixtureData());

async function logRecipe(profileId: string, recipeId: string) {
  return prisma.logEntry.create({ data: { profileId, date: toDbDate(PLAN_DATE), slot: "LUNCH", recipeId, ...RECIPE_NUTRITION } });
}

/** Dieselbe Abfrage wie DELETE /api/recipes (src/app/api/recipes/route.ts): nur eigene Rezepte des Profils. */
function deleteOwnRecipe(recipeId: string, ownerProfileId: string) {
  return prisma.recipe.deleteMany({ where: { id: recipeId, ownerProfileId, isCustom: true } });
}

// ---------------------------------------------------------------------------
// Grundlage: Die Testdatenbank prüft Foreign Keys wirklich
// ---------------------------------------------------------------------------

describe("Foreign Keys werden in der Testdatenbank erzwungen", () => {
  it("lehnt eine Zutatenzeile ab, deren Rezept nicht existiert (Pflichtverweis)", async () => {
    await expect(
      prisma.recipeIngredient.create({ data: { recipeId: "rezept-gibt-es-nicht", position: 0, displayName: "Reis" } }),
    ).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    expect(await prisma.recipeIngredient.count()).toBe(0);
  });

  it("lehnt auch einen ungültigen optionalen Verweis ab (LogEntry.recipeId)", async () => {
    const { profile } = await createPerson("A");
    await expect(logRecipe(profile.id, "rezept-gibt-es-nicht")).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    expect(await prisma.logEntry.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rezept löschen: MealPlanItem.recipe und MealPlanMeal.recipe haben kein onDelete -> Restrict (F-09)
// ---------------------------------------------------------------------------

describe("Rezept löschen: aktuelle Restrict-Semantik", () => {
  it("ein eigenes Rezept ohne Planverwendung lässt sich löschen, seine Zutatenzeilen gehen per Cascade mit", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl", profile.id);

    expect(await deleteOwnRecipe(recipe.id, profile.id)).toEqual({ count: 1 });
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0);
    expect(await prisma.recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(0);
  });

  it("ein Rezept im Tagesplan (MealPlanItem) blockiert das Löschen mit einem Foreign-Key-Fehler, nichts wird gelöscht", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    const dayPlan = await planInDayPlan(profile.id, recipe.id);

    await expect(deleteOwnRecipe(recipe.id, profile.id)).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
    expect(await prisma.recipeIngredient.count({ where: { recipeId: recipe.id } })).toBe(1);
    expect(await prisma.mealPlanItem.count({ where: { recipeId: recipe.id } })).toBe(1);

    // Gegenprobe: Ohne den Planeintrag lässt sich dasselbe Rezept löschen.
    await prisma.mealPlanDay.delete({ where: { id: dayPlan.id } });
    expect(await deleteOwnRecipe(recipe.id, profile.id)).toEqual({ count: 1 });
  });

  it("ein Rezept im Haushalts-Wochenplan (MealPlanMeal) blockiert das Löschen ebenso", async () => {
    const { user, profile } = await createPerson("A");
    const household = await createHousehold(user.id);
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    const weekPlan = await planInHouseholdPlan(household.id, recipe.id);

    await expect(deleteOwnRecipe(recipe.id, profile.id)).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
    expect(await prisma.mealPlanMeal.count({ where: { recipeId: recipe.id } })).toBe(1);

    // Gegenprobe: Ohne den Wochenplan lässt sich dasselbe Rezept löschen.
    await prisma.mealPlan.delete({ where: { id: weekPlan.id } });
    expect(await deleteOwnRecipe(recipe.id, profile.id)).toEqual({ count: 1 });
  });

  it("Log-Einträge blockieren nicht: sie behalten ihre Nährwerte und verlieren nur den Rezeptbezug (SetNull)", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    const entry = await logRecipe(profile.id, recipe.id);

    expect(await deleteOwnRecipe(recipe.id, profile.id)).toEqual({ count: 1 });
    expect(await prisma.logEntry.findUniqueOrThrow({ where: { id: entry.id } })).toMatchObject({ recipeId: null, kcal: RECIPE_NUTRITION.kcal });
  });
});

// ---------------------------------------------------------------------------
// Account löschen: Es gibt noch keinen Löschflow. `prisma.user.delete` steht stellvertretend für
// eine künftige Account-Löschung (User -> Profile ist Cascade, alle persönlichen Daten hängen am Profil).
// ---------------------------------------------------------------------------

describe("Account-Löschung: Ist-Zustand der Abhängigkeiten", () => {
  /** User als einziges Haushaltsmitglied, mit Präferenzen, Training, Log, Tagesplan und einem NICHT eingeplanten eigenen Rezept. */
  async function accountWithPersonalData() {
    const { user, profile } = await createPerson("A");
    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        allergies: { create: [{ label: "Erdnüsse" }] },
        likedFoods: { create: [{ label: "Reis" }] },
        trainingSessions: { create: [{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }] },
      },
    });
    const household = await createHousehold(user.id);
    const ownRecipe = await createRecipe("Eigene Reis-Bowl", profile.id);
    const catalogRecipe = await createRecipe("Katalog-Curry");
    await planInDayPlan(profile.id, catalogRecipe.id);
    await logRecipe(profile.id, catalogRecipe.id);
    return { user, profile, household, ownRecipe, catalogRecipe };
  }

  it("ohne eingeplante eigene Rezepte gelingt sie: Profil, Tagesplan, Log, Training, eigene Rezepte und Mitgliedschaft verschwinden per Cascade", async () => {
    const account = await accountWithPersonalData();

    await prisma.user.delete({ where: { id: account.user.id } });

    expect(await prisma.profile.count()).toBe(0);
    expect(await prisma.mealPlanDay.count()).toBe(0);
    expect(await prisma.mealPlanItem.count()).toBe(0);
    expect(await prisma.logEntry.count()).toBe(0);
    expect(await prisma.trainingSession.count()).toBe(0);
    expect(await prisma.householdMember.count()).toBe(0);
    expect(await prisma.recipe.count({ where: { id: account.ownRecipe.id } })).toBe(0);
    expect(await prisma.recipe.count({ where: { id: account.catalogRecipe.id } })).toBe(1);
  });

  it("übrig bleiben Präferenz-/Allergie-Zeilen ohne Profil (SetNull) und der Haushalt ohne Mitglieder", async () => {
    const account = await accountWithPersonalData();

    await prisma.user.delete({ where: { id: account.user.id } });

    const leftoverTags = await prisma.profileTag.findMany({ orderBy: { label: "asc" } });
    expect(leftoverTags.map((tag) => tag.label)).toEqual(["Erdnüsse", "Reis"]);
    for (const tag of leftoverTags) {
      expect(tag).toMatchObject({ likedByProfileId: null, dislikedByProfileId: null, allergyOfProfileId: null, priorityOfProfileId: null });
    }
    expect(await prisma.household.findUniqueOrThrow({ where: { id: account.household.id }, include: { members: true } })).toMatchObject({
      members: [],
    });
  });

  it("ein eigenes Rezept im Haushalts-Wochenplan blockiert sie, auch als einziges Mitglied: der Haushalt wird nicht mitgelöscht", async () => {
    const { user, profile } = await createPerson("A");
    const household = await createHousehold(user.id);
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    await planInHouseholdPlan(household.id, recipe.id);

    await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toMatchObject(FOREIGN_KEY_VIOLATION);
    // Die ganze Löschung scheitert, nicht nur das Rezept: User, Profil und Mitgliedschaft bleiben.
    expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    expect(await prisma.profile.count({ where: { id: profile.id } })).toBe(1);
    expect(await prisma.householdMember.count({ where: { userId: user.id } })).toBe(1);
  });

  /**
   * Heute gelingt das, aber nur zufällig: Das Profil löscht per Cascade sowohl den Tagesplan (samt
   * MealPlanItem) als auch das Rezept, und SQLite prüft den Restrict-Verweis MealPlanItem -> Recipe
   * sofort beim Löschen des Rezepts, nicht erst am Ende des Statements. Ob der Planeintrag dann schon
   * weg ist, hängt davon ab, in welcher Reihenfolge SQLite die Kaskaden abarbeitet - und die folgt der
   * Reihenfolge, in der die Tabellen angelegt wurden (in einer Scratch-Datenbank nachgestellt: mit
   * vertauschter Anlage-Reihenfolge scheitert dieselbe Löschung). Eine Migration, die eine der Tabellen
   * neu anlegt, oder PostgreSQL kann das Ergebnis also kippen; dieser Test schlägt dann an.
   */
  it("ein eigenes Rezept im eigenen Tagesplan blockiert sie derzeit nicht (abhängig von der Kaskaden-Reihenfolge)", async () => {
    const { user, profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    await planInDayPlan(profile.id, recipe.id);

    await prisma.user.delete({ where: { id: user.id } });

    expect(await prisma.mealPlanItem.count()).toBe(0);
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0);
  });
});
