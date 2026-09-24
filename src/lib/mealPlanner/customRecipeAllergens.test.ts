import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSchema, removeIsolatedDatabase, seedFoodCatalog } from "@/test/isolatedDatabase";

/**
 * F-03 (R2) über die echten Planungspfade gegen eine isolierte SQLite-Datenbank: eigene Rezepte
 * ohne Allergen-Angabe, deren Zutaten eindeutig ein Allergen enthalten, dürfen einem allergischen
 * Mitglied nicht als gültige Mahlzeit durchrutschen - auch nicht, wenn das Rezept einem anderen
 * Haushaltsmitglied gehört. Die echte prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r2-allergens-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { buildPlanningContext } = await import("./planningContext");
const { generateMealPlan } = await import("./plannerEngine");
const { getOrGenerateDayPlan } = await import("@/lib/generateMealPlan");

const NOW = new Date(2026, 8, 24, 9, 0, 0);
const TODAY = new Date(2026, 8, 24);
const ALL_DIETS = JSON.stringify(["OMNIVORE", "PESCETARIAN", "VEGETARIAN"]);

beforeAll(async () => {
  pushSchema(db);
  await seedFoodCatalog(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.mealPlanDay.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.householdMember.deleteMany();
  await prisma.household.deleteMany();
  await prisma.profileTag.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
});

async function person(name: string, allergies: string[]) {
  const user = await prisma.user.create({ data: { name } });
  const profile = await prisma.profile.create({
    data: {
      userId: user.id,
      age: 35,
      sex: "MALE",
      heightCm: 180,
      weightKg: 80,
      activityLevel: "MODERATE",
      goal: "MAINTAIN",
      dietType: "OMNIVORE",
      allergies: { create: allergies.map((label) => ({ label })) },
    },
  });
  return { user, profile };
}

/** Ein eigenes Rezept, bei dem der Autor keine Allergene angegeben hat (allergens = []). */
async function customRecipe(ownerProfileId: string, name: string, ingredients: string[], mealSlots: string[]) {
  return prisma.recipe.create({
    data: {
      name,
      description: "Eigenes Rezept",
      kcal: 550,
      proteinG: 25,
      carbsG: 60,
      fatG: 20,
      prepTimeMin: 10,
      mealSlots: JSON.stringify(mealSlots),
      dietTypes: ALL_DIETS,
      allergens: "[]",
      ingredients: JSON.stringify(ingredients),
      instructions: JSON.stringify(["Zubereiten."]),
      isCustom: true,
      sourceType: "user",
      ownerProfileId,
    },
  });
}

const PEANUT_TOAST = ["2 EL Erdnussbutter", "2 Scheiben Vollkorntoast"];
const TOMATO_RICE = ["150 g Reis", "2 Tomaten", "1 EL Olivenöl"];
/** Kein Allergen-Wort im Text - nur der FoodCatalog weiß, dass Skyr Milch enthält. */
const SKYR_BOWL = ["300 g Skyr", "1 Banane"];

async function householdOf(...members: { user: { id: string } }[]) {
  const household = await prisma.household.create({ data: { name: "Test-Haushalt" } });
  for (const [i, m] of members.entries()) {
    await prisma.householdMember.create({ data: { householdId: household.id, userId: m.user.id, role: i === 0 ? "OWNER" : "MEMBER" } });
  }
  return household;
}

describe("Haushalts-Planer (Fall D): Rezept eines anderen Mitglieds", () => {
  it("plant das Erdnuss-Rezept von A nicht für B mit Erdnuss-Allergie, das harmlose Rezept von A aber schon", async () => {
    const a = await person("A", []);
    const b = await person("B", ["Erdnüsse"]);
    await customRecipe(a.profile.id, "Erdnuss-Toast", PEANUT_TOAST, ["BREAKFAST"]);
    await customRecipe(a.profile.id, "Tomaten-Reis", TOMATO_RICE, ["LUNCH"]);
    const household = await householdOf(a, b);

    const context = await buildPlanningContext(household.id, null, NOW);
    expect(context.candidates.map((c) => c.name).sort()).toEqual(["Erdnuss-Toast", "Tomaten-Reis"]);

    const plan = generateMealPlan(context, { startDate: TODAY, days: 1, slots: ["BREAKFAST", "LUNCH"] }, NOW);
    expect(plan.meals.map((m) => m.recipeName)).toEqual(["Tomaten-Reis"]);
    expect(plan.unmetSlots.map((s) => s.slot)).toEqual(["BREAKFAST"]);
  });

  it("erkennt über den Food-Katalog auch Zutaten, deren Name kein Allergen nennt (Skyr bei Milchallergie)", async () => {
    const a = await person("A", []);
    const b = await person("B", ["Milch"]);
    await customRecipe(a.profile.id, "Skyr-Bowl", SKYR_BOWL, ["BREAKFAST"]);
    const household = await householdOf(a, b);

    const context = await buildPlanningContext(household.id, null, NOW);
    const plan = generateMealPlan(context, { startDate: TODAY, days: 1, slots: ["BREAKFAST"] }, NOW);
    expect(plan.meals).toEqual([]);
  });

  it("Gegenprobe: ohne Allergie im Haushalt wird das Erdnuss-Rezept geplant", async () => {
    const a = await person("A", []);
    const b = await person("B", []);
    await customRecipe(a.profile.id, "Erdnuss-Toast", PEANUT_TOAST, ["BREAKFAST"]);
    const household = await householdOf(a, b);

    const context = await buildPlanningContext(household.id, null, NOW);
    const plan = generateMealPlan(context, { startDate: TODAY, days: 1, slots: ["BREAKFAST"] }, NOW);
    expect(plan.meals.map((m) => m.recipeName)).toEqual(["Erdnuss-Toast"]);
  });
});

describe("Tagesplaner /plan und Dashboard (Fall C): eigenes Rezept", () => {
  it("schlägt das eigene Erdnuss-Rezept ohne Allergen-Angabe bei Erdnuss-Allergie nicht vor", async () => {
    const c = await person("C", ["Erdnüsse"]);
    await customRecipe(c.profile.id, "Erdnuss-Toast", PEANUT_TOAST, ["BREAKFAST"]);
    await customRecipe(c.profile.id, "Tomaten-Reis", TOMATO_RICE, ["LUNCH", "DINNER"]);

    const plan = await getOrGenerateDayPlan(c.profile.id, TODAY);
    const names = plan.items.map((item) => item.recipe.name);
    expect(names).not.toContain("Erdnuss-Toast");
    expect(names).toContain("Tomaten-Reis");
  });

  it("lädt den Food-Katalog auch ohne Vorlieben, sobald Allergien bestehen (Skyr bei Milchallergie)", async () => {
    const c = await person("C", ["Milch"]);
    await customRecipe(c.profile.id, "Skyr-Bowl", SKYR_BOWL, ["BREAKFAST"]);
    await customRecipe(c.profile.id, "Tomaten-Reis", TOMATO_RICE, ["LUNCH", "DINNER"]);

    const plan = await getOrGenerateDayPlan(c.profile.id, TODAY);
    expect(plan.items.map((item) => item.recipe.name)).not.toContain("Skyr-Bowl");
  });

  it("Gegenprobe: ohne Allergie wird das Erdnuss-Rezept zum Frühstück gewählt", async () => {
    const c = await person("C", []);
    await customRecipe(c.profile.id, "Erdnuss-Toast", PEANUT_TOAST, ["BREAKFAST"]);
    await customRecipe(c.profile.id, "Tomaten-Reis", TOMATO_RICE, ["LUNCH", "DINNER"]);

    const plan = await getOrGenerateDayPlan(c.profile.id, TODAY);
    expect(plan.items.map((item) => item.recipe.name)).toContain("Erdnuss-Toast");
  });
});
