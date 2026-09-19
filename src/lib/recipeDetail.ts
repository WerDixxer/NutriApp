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
  /** Gesamtzeit (prep + cook), falls gepflegt; Anzeige nutzt sie vor prepTimeMin. */
  totalTimeMin?: number | null;
  servings: number;
  ingredients: string;
  instructions: string;
  isTrending: boolean;
  trendSource: string | null;
  tags?: string;
  nutritionSource?: string;
}

/**
 * Personalisierte Variante eines Rezepts (recipes/personalization.ts): die
 * Zutatenzeilen mit den ausgetauschten Foods und die daraus NEU berechneten
 * Nährwerte je Portion (nicht die des Originals).
 */
export interface RecipePersonalizationInput {
  ingredientLines: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  swaps: { from: string; to: string }[];
}

/** Wandelt eine Prisma-Recipe-Zeile in die UI-Form um, optional skaliert auf eine Portionsgröße. */
export function dbRecipeToDetail(
  recipe: DbRecipeLike,
  portionMultiplier = 1,
  personalization?: RecipePersonalizationInput,
): RecipeDetail {
  const scale = (n: number) => Math.round(n * portionMultiplier * 10) / 10;
  const source = personalization ?? {
    ingredientLines: JSON.parse(recipe.ingredients) as string[],
    kcal: recipe.kcal,
    proteinG: recipe.proteinG,
    carbsG: recipe.carbsG,
    fatG: recipe.fatG,
  };
  const ingredients = source.ingredientLines.map((ing) => scaleIngredientText(ing, portionMultiplier));
  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    imageQuery: recipe.imageQuery ?? "",
    kcal: Math.round(source.kcal * portionMultiplier),
    proteinG: scale(source.proteinG),
    carbsG: scale(source.carbsG),
    fatG: scale(source.fatG),
    prepTimeMin: recipe.totalTimeMin ?? recipe.prepTimeMin,
    servings: recipe.servings,
    ingredients,
    instructions: JSON.parse(recipe.instructions) as string[],
    isTrending: recipe.isTrending,
    trendSource: recipe.trendSource,
    tags: recipe.tags ? (JSON.parse(recipe.tags) as string[]) : undefined,
    portionMultiplier,
    ...(personalization && personalization.swaps.length > 0
      ? { personalization: { swaps: personalization.swaps } }
      : {}),
  };
}
