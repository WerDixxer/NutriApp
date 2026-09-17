import type { DietType, MealSlot } from "@prisma/client";
import { prisma } from "../db";
import { calcFullTargets } from "../nutrition";
import { computeSingleItemScale } from "../foodMatching";
import { searchRecipes, type SearchableRecipe } from "./recipeSearch";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export interface RescueOption {
  recipe: SearchableRecipe;
  suggestedPortionMultiplier: number;
}

export interface RescueResult {
  remaining: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  options: RescueOption[];
}

/**
 * "Rette meine Makros": berechnet, was vom Tagesziel noch offen ist, und
 * schlägt Rezepte vor, deren Makro-Verhältnis zu genau diesem Rest passt,
 * inklusive vorgeschlagener Portionsgröße, damit der Rest möglichst genau
 * geschlossen wird (nicht nur thematisch passt).
 */
export async function macroRescue(profileId: string, now: Date = new Date()): Promise<RescueResult> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { allergies: true },
  });

  const targets = calcFullTargets({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    goalRateKgPerWeek: profile.goalRateKgPerWeek,
    sportType: profile.sportType,
  });

  const entries = await prisma.logEntry.findMany({
    where: { profileId, date: startOfDay(now) },
  });
  const consumed = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const remaining = {
    kcal: Math.max(targets.kcal - consumed.kcal, 0),
    proteinG: Math.max(targets.proteinG - consumed.proteinG, 0),
    carbsG: Math.max(targets.carbsG - consumed.carbsG, 0),
    fatG: Math.max(targets.fatG - consumed.fatG, 0),
  };

  const allRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
  });
  const allergyLabels = profile.allergies.map((a) => a.label);

  const searchable: SearchableRecipe[] = allRecipes
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      kcal: r.kcal,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      prepTimeMin: r.prepTimeMin,
      servings: r.servings,
      mealSlots: JSON.parse(r.mealSlots) as MealSlot[],
      dietTypes: JSON.parse(r.dietTypes) as DietType[],
      allergens: JSON.parse(r.allergens) as string[],
      ingredients: JSON.parse(r.ingredients) as string[],
      tags: JSON.parse(r.tags) as string[],
      isTrending: r.isTrending,
    }))
    .filter((r) => r.dietTypes.includes(profile.dietType));

  const matches = searchRecipes(
    {
      calorieTarget: remaining.kcal,
      proteinTarget: remaining.proteinG,
      carbTarget: remaining.carbsG,
      fatTarget: remaining.fatG,
      allergies: allergyLabels,
    },
    searchable,
    3,
  );

  const options: RescueOption[] = matches.map((m) => ({
    recipe: m.recipe,
    suggestedPortionMultiplier: computeSingleItemScale(
      { kcal: remaining.kcal, proteinG: remaining.proteinG, carbsG: remaining.carbsG, fatG: remaining.fatG },
      { kcal: m.recipe.kcal, proteinG: m.recipe.proteinG, carbsG: m.recipe.carbsG, fatG: m.recipe.fatG },
    ),
  }));

  return { remaining, options };
}
