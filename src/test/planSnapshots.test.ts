import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Rezept-Snapshots der Planeinträge und die Mitglieder-Historie von Haushaltsplänen (R5E-5) gegen eine
 * isolierte SQLite-Datenbank: Schreiben beim Planen, Lesen nach späteren Rezeptänderungen, Einträge
 * ohne Snapshot (von vor R5E), Neuplanung, Restrict beim Rezept-Löschen und ehemalige Mitglieder.
 * prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5e5-snapshots-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan, regenerateEditableDays } = await import("@/lib/generateMealPlan");
const { buildWeekLedger, collectPlanRecipes } = await import("@/lib/weekLedger");
const { dbRecipeToDetail } = await import("@/lib/recipeDetail");
const { recipeAsPlanned } = await import("@/lib/recipeAsPlanned");
const { generateAndSaveMealPlan } = await import("@/lib/mealPlanner/generate");
const { createMealPlan, getMealPlan } = await import("@/lib/mealPlanner/mealPlanService");
const { removeMember } = await import("@/lib/household/householdService");
const { getWeeklyShoppingForProfile } = await import("@/lib/shopping/weeklyShoppingService");
const { createPerson, createRecipe, createHousehold, planInDayPlan, planInHouseholdPlan, clearFixtureData } = databaseFixtures(prisma);

/** Donnerstag: gestern ist historisch, heute bearbeitbar. */
const TODAY: CalendarDate = "2026-09-24";
const YESTERDAY: CalendarDate = "2026-09-23";
const MONDAY: CalendarDate = "2026-09-21";
const NOW = new Date("2026-09-24T10:00:00+02:00");

/** Werte aus databaseFixtures.createRecipe: "Reis-Bowl", 450 kcal, 25 g Protein, 50 g Carbs, 12 g Fett, Zutat "150 g Reis". */
const PLANNED_SNAPSHOT = { recipeName: "Reis-Bowl", recipeKcal: 450, recipeProteinG: 25, recipeCarbsG: 50, recipeFatG: 12 };

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
});

/** Ändert das Rezept nach dem Planen: neuer Name, neue Nährwerte, neue Zutaten und Schritte. */
function changeRecipe(recipeId: string) {
  return prisma.recipe.update({
    where: { id: recipeId },
    data: {
      name: "Reis-Bowl Deluxe",
      kcal: 700,
      proteinG: 42,
      carbsG: 80,
      fatG: 21,
      ingredients: JSON.stringify(["200 g Basmatireis", "100 g Tofu"]),
      instructions: JSON.stringify(["Neu zubereiten."]),
    },
  });
}

function storedItems(profileId: string, day: CalendarDate) {
  return prisma.mealPlanItem.findMany({ where: { mealPlanDay: { profileId, date: toDbDate(day) } }, orderBy: { time: "asc" } });
}

describe("Tagesplan: Rezept-Snapshot (R5E-5)", () => {
  it("speichert beim Erzeugen Name und Nährwerte je Portion des geplanten Rezepts, den Portionsfaktor unverändert daneben", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl");

    const plan = await getOrGenerateDayPlan(profile.id, TODAY, TODAY);

    const items = await storedItems(profile.id, TODAY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ recipeId: recipe.id, ...PLANNED_SNAPSHOT });
    expect(items[0].portionMultiplier).toBe(plan!.items[0].portionMultiplier);
  });

  it("ein historischer Tag zeigt nach einer Rezeptänderung alten Namen und alte Nährwerte, Zutaten und Schritte aber aktuell", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl");
    await getOrGenerateDayPlan(profile.id, YESTERDAY, YESTERDAY); // gestern geplant, als es heute war
    await changeRecipe(recipe.id);

    const week = await getOrGenerateWeekPlan(profile.id, MONDAY, TODAY);
    const plans = week.map((plan) => plan ?? { items: [] });
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans, today: TODAY });
    const meal = ledger.days[2].meals[0]; // Mittwoch = gestern

    expect(meal.name).toBe("Reis-Bowl");
    expect(meal.plannedRecipe).toEqual({ name: "Reis-Bowl", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 });
    expect(meal.kcal).toBe(Math.round(450 * meal.portionMultiplier));

    // Der Rezept-Dialog: Name und Nährwerte wie geplant, Zutaten und Schritte aus dem aktuellen Rezept.
    const current = collectPlanRecipes(plans)[recipe.id];
    const detail = dbRecipeToDetail({ ...current, ...meal.plannedRecipe, imageQuery: null }, 1);
    expect(detail).toMatchObject({ name: "Reis-Bowl", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 });
    expect(detail.ingredients).toEqual(["200 g Basmatireis", "100 g Tofu"]);
    expect(detail.instructions).toEqual(["Neu zubereiten."]);
  });

  it("ein Eintrag ohne Snapshot (von vor R5E) zeigt das aktuelle Rezept", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl");
    await planInDayPlan(profile.id, recipe.id); // Fixture ohne Snapshot-Spalten
    await changeRecipe(recipe.id);

    const [legacy] = await prisma.mealPlanItem.findMany({ where: { recipeId: recipe.id }, include: { recipe: true } });

    expect(legacy).toMatchObject({ recipeName: null, recipeKcal: null, recipeProteinG: null, recipeCarbsG: null, recipeFatG: null });
    expect(recipeAsPlanned(legacy)).toMatchObject({ name: "Reis-Bowl Deluxe", kcal: 700, proteinG: 42, carbsG: 80, fatG: 21 });
  });

  it("die Neuplanung schreibt frische Snapshots für heute und lässt den historischen Snapshot unverändert", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl");
    await getOrGenerateDayPlan(profile.id, YESTERDAY, YESTERDAY);
    await getOrGenerateDayPlan(profile.id, TODAY, TODAY);
    await prisma.logEntry.create({
      data: { profileId: profile.id, date: toDbDate(YESTERDAY), slot: "LUNCH", recipeId: recipe.id, kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 },
    });
    const yesterdayBefore = await storedItems(profile.id, YESTERDAY);
    const logsBefore = await prisma.logEntry.findMany({ where: { profileId: profile.id } });
    await changeRecipe(recipe.id);

    await regenerateEditableDays(profile.id, TODAY);

    expect(await storedItems(profile.id, YESTERDAY)).toEqual(yesterdayBefore);
    expect(yesterdayBefore[0]).toMatchObject(PLANNED_SNAPSHOT);
    expect((await storedItems(profile.id, TODAY))[0]).toMatchObject({
      recipeName: "Reis-Bowl Deluxe",
      recipeKcal: 700,
      recipeProteinG: 42,
      recipeCarbsG: 80,
      recipeFatG: 21,
    });
    expect(await prisma.logEntry.findMany({ where: { profileId: profile.id } })).toEqual(logsBefore);
  });

  it("ein Rezept mit Snapshot-Planeintrag lässt sich weiterhin nicht löschen (Restrict); der Eintrag bleibt vollständig", async () => {
    const { profile } = await createPerson("A");
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    await getOrGenerateDayPlan(profile.id, TODAY, TODAY);
    const before = await storedItems(profile.id, TODAY);

    await expect(prisma.recipe.delete({ where: { id: recipe.id } })).rejects.toMatchObject({ code: "P2003" });

    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
    expect(await storedItems(profile.id, TODAY)).toEqual(before);
  });
});

describe("Haushaltsplan: Rezept-Snapshot (R5E-5)", () => {
  it("speichert beim Erzeugen Name und Nährwerte je Portion des geplanten Rezepts und zeigt sie nach einer Rezeptänderung weiter", async () => {
    const { user } = await createPerson("A");
    const household = await createHousehold(user.id);
    const recipe = await createRecipe("Reis-Bowl");

    const result = await generateAndSaveMealPlan(
      { householdId: household.id, householdMemberIds: null, startDate: TODAY, days: 1, slots: ["LUNCH"] },
      NOW,
    );
    expect(result.plan?.meals).toHaveLength(1);
    const [stored] = await prisma.mealPlanMeal.findMany({ where: { mealPlanId: result.plan!.id } });
    expect(stored).toMatchObject({ recipeId: recipe.id, ...PLANNED_SNAPSHOT });
    expect(stored.portionMultiplier).toBe(result.plan!.meals[0].portionMultiplier);

    await changeRecipe(recipe.id);

    const plan = await getMealPlan(household.id, result.plan!.id);
    expect(recipeAsPlanned(plan!.meals[0])).toMatchObject({ name: "Reis-Bowl", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 });
    // Die Zutaten bleiben live - wichtig für Meal Prep und Einkauf.
    expect(recipeAsPlanned(plan!.meals[0]).ingredients).toBe(JSON.stringify(["200 g Basmatireis", "100 g Tofu"]));
  });

  it("eine Mahlzeit ohne Snapshot (von vor R5E) zeigt das aktuelle Rezept", async () => {
    const { user } = await createPerson("A");
    const household = await createHousehold(user.id);
    const recipe = await createRecipe("Reis-Bowl");
    const legacyPlan = await planInHouseholdPlan(household.id, recipe.id); // Fixture ohne Snapshot-Spalten
    await changeRecipe(recipe.id);

    const plan = await getMealPlan(household.id, legacyPlan.id);

    expect(plan!.meals[0].recipeName).toBeNull();
    expect(recipeAsPlanned(plan!.meals[0])).toMatchObject({ name: "Reis-Bowl Deluxe", kcal: 700 });
  });
});

describe("Haushaltsplan: ehemalige Mitglieder (R5E-5)", () => {
  async function householdPlanForTwo() {
    const owner = await createPerson("Owner");
    const household = await createHousehold(owner.user.id);
    const second = await createPerson("Zweites Mitglied");
    const secondMember = await prisma.householdMember.create({ data: { householdId: household.id, userId: second.user.id, role: "MEMBER" } });
    const ownerMember = await prisma.householdMember.findUniqueOrThrow({ where: { userId: owner.user.id } });
    const recipe = await createRecipe("Reis-Bowl");
    const { plan } = await createMealPlan(household.id, {
      startDate: YESTERDAY,
      endDate: YESTERDAY,
      householdMemberIds: [ownerMember.id, secondMember.id],
      meals: [{ date: YESTERDAY, slot: "LUNCH", recipeId: recipe.id, ...PLANNED_SNAPSHOT, portionMultiplier: 2, reasons: [] }],
      status: "ACTIVE",
    });
    return { household, plan, ownerMember, secondMember, second };
  }

  it("ein entferntes Mitglied bleibt als ehemaliges Mitglied im Plan (householdMemberId NULL), Plan und Mahlzeiten bleiben", async () => {
    const { household, plan, ownerMember, secondMember } = await householdPlanForTwo();

    expect(await removeMember(household.id, secondMember.id)).toEqual({ ok: true });

    const after = await getMealPlan(household.id, plan.id);
    expect(after!.members).toHaveLength(2);
    expect(after!.members.map((m) => m.householdMemberId).sort()).toEqual([ownerMember.id, null].sort());
    expect(after!.members.find((m) => m.householdMemberId === null)?.householdMember).toBeNull();
    expect(after!.meals).toHaveLength(1);
    expect(after!.meals[0]).toMatchObject(PLANNED_SNAPSHOT);
  });

  it("auch nach Löschung des Kontos bleibt das Mitglied als ehemaliges Mitglied erhalten", async () => {
    const { household, plan, second } = await householdPlanForTwo();

    await prisma.user.delete({ where: { id: second.user.id } });

    const after = await getMealPlan(household.id, plan.id);
    expect(after!.members).toHaveLength(2);
    expect(after!.members.filter((m) => m.householdMemberId === null)).toHaveLength(1);
  });
});

describe("Einkaufsliste und historische Tage (R5F-6)", () => {
  it("ein vergangener Tag erzeugt keinen Einkaufsbedarf und bleibt samt Einträgen und Snapshot unverändert gespeichert", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl"); // Zutat "150 g Reis"
    await getOrGenerateDayPlan(profile.id, YESTERDAY, YESTERDAY);
    await getOrGenerateDayPlan(profile.id, TODAY, TODAY);
    const yesterdayBefore = await storedItems(profile.id, YESTERDAY);
    const [todayItem] = await storedItems(profile.id, TODAY);

    const shopping = await getWeeklyShoppingForProfile(profile.id, TODAY, NOW);

    expect(shopping.plannedDays).toBe(2);
    expect(shopping.items).toEqual([
      expect.objectContaining({ ingredientName: "Reis", requiredQuantity: Math.round(150 * todayItem.portionMultiplier * 100) / 100 }),
    ]);
    expect(await storedItems(profile.id, YESTERDAY)).toEqual(yesterdayBefore);
  });
});
