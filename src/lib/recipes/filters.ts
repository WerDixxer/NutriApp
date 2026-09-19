import { normalizeTag, sportsFromTags, type MealSlotName, type SportName } from "./tags";

/** Minimale Sicht auf ein Rezept, die alle Filter des Auftrags brauchen. */
export interface FilterableRecipe {
  mealSlots: string[];
  dietTypes: string[];
  tags: string[];
  kcal: number;
  proteinG: number;
  /** totalTimeMin ?? prepTimeMin */
  timeMin: number;
  mealPrepSuitable: boolean;
}

export interface NumericRange {
  min?: number;
  max?: number;
}

export interface RecipeFilter {
  /** Mahlzeit (Frühstück/Mittag/Abend/Snack/Pre-/Post-Workout): mindestens einer muss passen. */
  mealSlots?: MealSlotName[];
  dessert?: boolean;
  /** Ernährungsform laut `dietTypes` (vegetarisch, vegan, pescetarisch): alle angegebenen müssen passen. */
  diets?: ("vegetarian" | "vegan" | "pescatarian")[];
  highProtein?: boolean;
  lowCalorie?: boolean;
  lowCarb?: boolean;
  keto?: boolean;
  highFiber?: boolean;
  mealPrep?: boolean;
  quick?: boolean;
  budgetFriendly?: boolean;
  /** Fußball/Krafttraining/Cardio: mindestens eine Sportart muss passen. */
  sports?: SportName[];
  kcal?: NumericRange;
  protein?: NumericRange;
  /** Zubereitungszeit gesamt in Minuten. */
  maxTimeMin?: number;
}

const QUICK_THRESHOLD_MIN = 20;

function inRange(value: number, range?: NumericRange): boolean {
  if (!range) return true;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

/**
 * Harte Facettenfilter über die gespeicherten Rezeptdaten (kein Scoring,
 * dafür gibt es recipeSearch.ts für den Assistant). Tag-Filter nutzen die
 * kuratierten Tags; Keto/Low-Carb zusätzlich `dietTypes`, "schnell" zusätzlich
 * die echte Gesamtzeit.
 */
export function filterRecipes<T extends FilterableRecipe>(recipes: T[], filter: RecipeFilter): T[] {
  return recipes.filter((recipe) => {
    const tags = new Set(recipe.tags.map(normalizeTag));

    if (filter.mealSlots?.length && !filter.mealSlots.some((s) => recipe.mealSlots.includes(s))) return false;
    if (filter.dessert && !tags.has("dessert")) return false;

    if (filter.diets?.length) {
      const wanted = filter.diets.map((d) => d.toUpperCase().replace("PESCATARIAN", "PESCETARIAN"));
      if (!wanted.every((d) => recipe.dietTypes.includes(d))) return false;
    }

    if (filter.highProtein && !tags.has("high-protein")) return false;
    if (filter.lowCalorie && !tags.has("low-calorie")) return false;
    if (filter.lowCarb && !(tags.has("low-carb") || recipe.dietTypes.includes("LOW_CARB"))) return false;
    if (filter.keto && !(tags.has("keto") || recipe.dietTypes.includes("KETO"))) return false;
    if (filter.highFiber && !tags.has("high-fiber")) return false;
    if (filter.mealPrep && !(recipe.mealPrepSuitable || tags.has("meal-prep"))) return false;
    if (filter.quick && !(tags.has("quick") || recipe.timeMin <= QUICK_THRESHOLD_MIN)) return false;
    if (filter.budgetFriendly && !tags.has("budget-friendly")) return false;

    if (filter.sports?.length) {
      const sports = sportsFromTags(recipe.tags);
      if (!filter.sports.some((s) => sports.includes(s))) return false;
    }

    if (!inRange(recipe.kcal, filter.kcal)) return false;
    if (!inRange(recipe.proteinG, filter.protein)) return false;
    if (filter.maxTimeMin !== undefined && recipe.timeMin > filter.maxTimeMin) return false;

    return true;
  });
}
