import { prisma } from "../db";
import { computeSingleItemScale } from "../foodMatching";
import { searchRecipes, type SearchableRecipe } from "./recipeSearch";
import { getRemainingDailyTargets } from "./remainingTargets";
import { dbRecipeToSearchable } from "./searchableRecipe";

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

  const remaining = await getRemainingDailyTargets(profileId, now);

  const allRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
  });
  const allergyLabels = profile.allergies.map((a) => a.label);

  const searchable: SearchableRecipe[] = allRecipes
    .map(dbRecipeToSearchable)
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
