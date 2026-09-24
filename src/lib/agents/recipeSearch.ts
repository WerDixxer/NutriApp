import type { DietType, MealSlot } from "@prisma/client";
import { ingredientListIncludes, macroProfile, matchesAllergen } from "../foodMatching";import type { FoodCatalog } from "../recipes/catalog";
import { conflictingLabels } from "../recipes/foodPreferences";
import type { StructuredIngredient } from "../recipes/types";

/**
 * Strukturierte Parameter, in die der Food Assistant natürliche Sprache
 * übersetzt (angelehnt an die im Produkt-Auftrag skizzierte Struktur).
 * Felder, die wir nicht ehrlich beantworten können (Budget/Küche ohne
 * Preis-/Cuisine-Daten), fließen nur als weiche Hinweise ein statt als
 * erfundene harte Filter.
 */
export interface NutritionQuery {
  calorieTarget?: number;
  proteinTarget?: number;
  carbTarget?: number;
  fatTarget?: number;
  availableIngredients?: string[];
  excludedIngredients?: string[];
  dietaryPreferences?: string[];
  allergies?: string[];
  maxPreparationTimeMin?: number;
  mealType?: string;
}

export interface SearchableRecipe {
  id: string;
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  prepTimeMin: number;
  servings: number;
  mealSlots: MealSlot[];
  dietTypes: DietType[];
  allergens: string[];
  ingredients: string[];
  /** Strukturierte Zutaten (nur Katalogrezepte); fehlen sie, gilt der Text in `ingredients`. */
  structured?: StructuredIngredient[];
  tags: string[];
  isTrending: boolean;
}

export interface RecipeMatch {
  recipe: SearchableRecipe;
  score: number;
}

const MEAL_TYPE_ALIASES: Record<string, MealSlot> = {
  breakfast: "BREAKFAST",
  frühstück: "BREAKFAST",
  fruehstueck: "BREAKFAST",
  lunch: "LUNCH",
  mittag: "LUNCH",
  mittagessen: "LUNCH",
  dinner: "DINNER",
  abendessen: "DINNER",
  abend: "DINNER",
  snack: "SNACK",
  zwischenmahlzeit: "SNACK",
  "pre-workout": "PRE_WORKOUT",
  "vor dem training": "PRE_WORKOUT",
  "post-workout": "POST_WORKOUT",
  "nach dem training": "POST_WORKOUT",
};

export function resolveMealSlot(mealType?: string): MealSlot | null {
  if (!mealType) return null;
  return MEAL_TYPE_ALIASES[mealType.trim().toLowerCase()] ?? null;
}

function resolveDietType(pref: string): DietType | null {
  const key = pref.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const known: DietType[] = [
    "OMNIVORE",
    "VEGETARIAN",
    "VEGAN",
    "PESCETARIAN",
    "KETO",
    "LOW_CARB",
    "HALAL",
    "KOSHER",
    "PALEO",
  ];
  // Deutsche Alltagsbegriffe zusätzlich abdecken.
  const aliases: Record<string, DietType> = {
    VEGETARISCH: "VEGETARIAN",
    VEGAN: "VEGAN",
    PESCETARISCH: "PESCETARIAN",
  };
  return known.find((d) => d === key) ?? aliases[key] ?? null;
}

/**
 * Filtert + bewertet Rezepte deterministisch anhand strukturierter Parameter.
 * Erfindet nie Nährwerte, arbeitet ausschließlich mit den gespeicherten,
 * echten Werten der Rezept-Datenbank. Rückgabe absteigend nach Score sortiert.
 */
export function searchRecipes(
  query: NutritionQuery,
  candidates: SearchableRecipe[],
  limit = 5,
  catalog?: FoodCatalog,
): RecipeMatch[] {
  const targetSlot = resolveMealSlot(query.mealType);
  const hardDietTypes = (query.dietaryPreferences ?? [])
    .map(resolveDietType)
    .filter((d): d is DietType => d !== null);

  const filtered = candidates.filter((r) => {
    if (targetSlot && !r.mealSlots.includes(targetSlot)) return false;
    if (query.maxPreparationTimeMin && r.prepTimeMin > query.maxPreparationTimeMin) return false;
    if (matchesAllergen(r.allergens, query.allergies ?? [], r.ingredients, catalog)) return false;
    const excluded = query.excludedIngredients ?? [];
    const hitsExcluded = catalog
      ? conflictingLabels(r, excluded, catalog).length > 0
      : excluded.some((ex) => ingredientListIncludes(r.ingredients, ex));
    if (hitsExcluded) return false;
    if (hardDietTypes.length > 0 && !hardDietTypes.every((d) => r.dietTypes.includes(d))) {
      return false;
    }
    return true;
  });

  const hasTargets =
    query.calorieTarget || query.proteinTarget || query.carbTarget || query.fatTarget;
  const targetProfile = hasTargets
    ? macroProfile(
        query.calorieTarget ?? 500,
        query.proteinTarget ?? 30,
        query.carbTarget ?? 50,
        query.fatTarget ?? 15,
      )
    : null;

  const scored = filtered.map((recipe) => {
    let score = 0;

    if (targetProfile) {
      const recipeProfile = macroProfile(recipe.kcal, recipe.proteinG, recipe.carbsG, recipe.fatG);
      const diff =
        Math.abs(recipeProfile.protein - targetProfile.protein) * 1.3 +
        Math.abs(recipeProfile.carbs - targetProfile.carbs) +
        Math.abs(recipeProfile.fat - targetProfile.fat);
      score -= diff;

      if (query.calorieTarget) {
        score -= Math.abs(recipe.kcal - query.calorieTarget) / query.calorieTarget;
      }
    }

    const availableMatches = (query.availableIngredients ?? []).filter((ing) =>
      ingredientListIncludes(recipe.ingredients, ing),
    ).length;
    score += availableMatches * 0.4;

    // Weiche Diät-Präferenzen (z.B. Küchenstil ohne eigenes Datenfeld) gegen
    // Name/Beschreibung/Tags matchen, statt sie zu ignorieren oder hart zu filtern.
    const softPrefs = (query.dietaryPreferences ?? []).filter(
      (p) => !resolveDietType(p),
    );
    const haystack = `${recipe.name} ${recipe.description} ${recipe.tags.join(" ")}`.toLowerCase();
    score += softPrefs.filter((p) => haystack.includes(p.toLowerCase())).length * 0.3;

    if (recipe.isTrending) score += 0.1;

    return { recipe, score };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
