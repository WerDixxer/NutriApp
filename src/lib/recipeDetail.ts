import type { RecipeDetail } from "@/components/RecipeDetailModal";
import { scaleIngredientText } from "./scaleIngredient";

export interface DbRecipeLike {
  id: string;
  name: string;
  description: string;
  imageQuery: string | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  prepTimeMin: number;
  servings: number;
  ingredients: string;
  instructions: string;
  isTrending: boolean;
  trendSource: string | null;
  tags?: string;
  nutritionSource?: string;
}

/** Wandelt eine Prisma-Recipe-Zeile in die UI-Form um, optional skaliert auf eine Portionsgröße. */
export function dbRecipeToDetail(recipe: DbRecipeLike, portionMultiplier = 1): RecipeDetail {
  const scale = (n: number) => Math.round(n * portionMultiplier * 10) / 10;
  const ingredients = (JSON.parse(recipe.ingredients) as string[]).map((ing) =>
    scaleIngredientText(ing, portionMultiplier),
  );
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    imageQuery: recipe.imageQuery ?? "",
    kcal: Math.round(recipe.kcal * portionMultiplier),
    proteinG: scale(recipe.proteinG),
    carbsG: scale(recipe.carbsG),
    fatG: scale(recipe.fatG),
    prepTimeMin: recipe.prepTimeMin,
    servings: recipe.servings,
    ingredients,
    instructions: JSON.parse(recipe.instructions) as string[],
    isTrending: recipe.isTrending,
    trendSource: recipe.trendSource,
    tags: recipe.tags ? (JSON.parse(recipe.tags) as string[]) : undefined,
    portionMultiplier,
  };
}
