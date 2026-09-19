import type { DietType, MealSlot } from "@prisma/client";
import { prisma } from "../db";
import type { SearchableRecipe } from "./recipeSearch";

type RecipeRow = Awaited<ReturnType<typeof prisma.recipe.findMany>>[number];

/** Gemeinsamer Mapper DB-Recipe -> SearchableRecipe, genutzt von foodAssistant.ts und der Decision Engine. */
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
    mealSlots: JSON.parse(r.mealSlots) as MealSlot[],
    dietTypes: JSON.parse(r.dietTypes) as DietType[],
    allergens: JSON.parse(r.allergens) as string[],
    ingredients: JSON.parse(r.ingredients) as string[],
    tags: JSON.parse(r.tags) as string[],
    isTrending: r.isTrending,
  };
}
