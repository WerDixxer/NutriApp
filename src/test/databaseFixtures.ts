import type { PrismaClient } from "@prisma/client";
import { toDbDate, type CalendarDate } from "@/lib/calendarDate";

/**
 * Minimale Testdaten für Integrationstests gegen eine isolierte SQLite-Datenbank (siehe
 * isolatedDatabase.ts): nur Pflichtfelder plus das, was die Tests prüfen.
 * Nutzung: `const { createPerson, createRecipe } = databaseFixtures(prisma);`
 */
/** Kalendertag der Planeinträge (in der DB als UTC-Mitternacht, siehe src/lib/calendarDate.ts). */
export const PLAN_DATE: CalendarDate = "2026-09-24";
export const RECIPE_NUTRITION = { kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 };

export function databaseFixtures(prisma: PrismaClient) {
  async function createPerson(name: string) {
    const user = await prisma.user.create({ data: { name } });
    const profile = await prisma.profile.create({
      data: { userId: user.id, age: 30, sex: "FEMALE", heightCm: 165, weightKg: 60, activityLevel: "LIGHT", goal: "MAINTAIN" },
    });
    return { user, profile };
  }

  /** Rezept mit einer strukturierten Zutatenzeile: mit `ownerProfileId` ein eigenes Rezept, sonst ein Katalogrezept. */
  async function createRecipe(name: string, ownerProfileId?: string) {
    return prisma.recipe.create({
      data: {
        name,
        description: "",
        ...RECIPE_NUTRITION,
        prepTimeMin: 15,
        mealSlots: JSON.stringify(["LUNCH"]),
        dietTypes: JSON.stringify(["OMNIVORE"]),
        allergens: "[]",
        ingredients: JSON.stringify(["150 g Reis"]),
        instructions: JSON.stringify(["Reis kochen."]),
        ...(ownerProfileId ? { isCustom: true, sourceType: "user", ownerProfileId } : {}),
        ingredientRows: { create: [{ position: 0, displayName: "Reis", amount: 150, unit: "g" }] },
      },
    });
  }

  async function createHousehold(ownerUserId: string) {
    return prisma.household.create({ data: { name: "Test-Haushalt", members: { create: [{ userId: ownerUserId, role: "OWNER" }] } } });
  }

  /** Persönlicher Tagesplan (Dashboard, /plan): MealPlanDay mit einem MealPlanItem, das auf das Rezept zeigt. */
  async function planInDayPlan(profileId: string, recipeId: string) {
    return prisma.mealPlanDay.create({
      data: {
        profileId,
        date: toDbDate(PLAN_DATE),
        targetKcal: 2000,
        targetProteinG: 110,
        targetCarbsG: 230,
        targetFatG: 70,
        items: { create: [{ slot: "LUNCH", time: "12:30", recipeId }] },
      },
    });
  }

  /** Essensplan eines Haushalts (/meal-plans): MealPlan mit einem MealPlanMeal, das auf das Rezept zeigt. */
  async function planInHouseholdPlan(householdId: string, recipeId: string) {
    return prisma.mealPlan.create({
      data: {
        householdId,
        startDate: toDbDate(PLAN_DATE),
        endDate: toDbDate(PLAN_DATE),
        meals: { create: [{ date: toDbDate(PLAN_DATE), slot: "DINNER", recipeId }] },
      },
    });
  }

  /**
   * Räumt alles ab, was diese Fixtures (und Log-Einträge darauf) anlegen. Reihenfolge: zuerst alles,
   * was Rezepte referenziert - Essenspläne hängen per Cascade am Haushalt, Tagesplan-Einträge am
   * Tagesplan -, danach lassen sich Rezepte und User (samt Profil) löschen.
   */
  async function clearFixtureData() {
    await prisma.household.deleteMany();
    await prisma.mealPlanDay.deleteMany();
    await prisma.logEntry.deleteMany();
    await prisma.profileTag.deleteMany();
    await prisma.recipe.deleteMany();
    await prisma.user.deleteMany();
  }

  return { createPerson, createRecipe, createHousehold, planInDayPlan, planInHouseholdPlan, clearFixtureData };
}
