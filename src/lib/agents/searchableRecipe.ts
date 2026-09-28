import { prisma } from "../db";
import { readRecipeDietTypes, readRecipeMealSlots, readRecipeStringList } from "../recipes/recipeJsonColumns";
import type { SearchableRecipe } from "./recipeSearch";

type RecipeRow = Awaited<ReturnType<typeof prisma.recipe.findMany>>[number];

/**
 * Gemeinsamer Mapper DB-Recipe -> SearchableRecipe, genutzt von foodAssistant.ts und der Decision Engine.
 * Wirft `JsonColumnError` bei unlesbarer JSON-Spalte; Kandidaten-Pools filtern solche Zeilen per
 * `skipUnreadableRows` heraus.
 */
export function dbRecipeToSearchable(r: RecipeRow): SearchableRecipe {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kcal: r.kcal,
    proteinG: r.proteinG,
    carbsG: r.carbsG,
    fatG: r.fatG,
    prepTimeMin: r.totalTimeMin ?? r.prepTimeMin,
    servings: r.servings,
    mealSlots: readRecipeMealSlots(r),
    dietTypes: readRecipeDietTypes(r),
    allergens: readRecipeStringList(r, "allergens"),
    ingredients: readRecipeStringList(r, "ingredients"),
    tags: readRecipeStringList(r, "tags"),
    isTrending: r.isTrending,
  };
}
