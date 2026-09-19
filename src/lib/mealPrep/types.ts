import type { PantryUnit } from "@prisma/client";
import type { RotationUrgency } from "../rotation/types";
import type { FactorResult } from "../agents/decision/softScoring";

export const MEAL_PREP_STRATEGIES = ["MIN_COOKING", "BALANCED", "FRESHNESS"] as const;
export type MealPrepStrategy = (typeof MEAL_PREP_STRATEGIES)[number];

export interface SourceMealRef {
  mealId: string;
  date: Date;
  slot: string;
  recipeId: string;
  recipeName: string;
  /** Für DIESE Mahlzeit benötigte Menge (bereits mit ihrem portionMultiplier skaliert). */
  quantityForMeal: number;
}

export interface PantryContribution {
  availableQuantity: number;
  urgency: RotationUrgency | null;
}

export interface AggregatedIngredient {
  /**
   * Eindeutiger Schlüssel DIESER Gruppe (`${normalizedName}::${unit}`) - zwei
   * Einträge derselben Zutat in inkompatiblen Einheiten (z.B. "ei" als g UND
   * als Stück) haben bewusst unterschiedliche `key`-Werte, damit sie in
   * Union-Find/Batching (siehe batching.ts) nie fälschlich als identisch
   * gelten. Für Pantry-/Preis-Matching (nur der Name zählt, die Einheit wird
   * dort separat per convertQuantity() geprüft) siehe `normalizedName`.
   */
  key: string;
  /** normalizeIngredientKey()-Ergebnis OHNE Einheit, für Pantry-/Preis-Namensabgleich. */
  normalizedName: string;
  displayName: string;
  unit: PantryUnit;
  totalQuantity: number;
  /** Anzahl VERSCHIEDENER Rezepte (nicht Mahlzeiten), die diese Zutat brauchen - Grundlage für "batchbar". */
  recipeCount: number;
  sourceMeals: SourceMealRef[];
  pantry: PantryContribution | null;
  costCents: number | null;
}

export interface PrepTask {
  ingredientKey: string;
  displayName: string;
  totalQuantity: number;
  unit: PantryUnit;
  usedForMeals: SourceMealRef[];
  pantry: PantryContribution | null;
}

export interface PrepGroup {
  id: string;
  name: string;
  tasks: PrepTask[];
  sourceRecipeIds: string[];
  earliestNeededDate: Date;
  latestNeededDate: Date;
  /** Summe der prepTimeMin der beteiligten Rezepte (echte DB-Werte, keine Zeitersparnis-Behauptung, siehe Abschnitt 24). */
  combinedPrepTimeMin: number;
}

export interface MealRef {
  mealId: string;
  date: Date;
  slot: string;
}

export interface SoloRecipe {
  recipeId: string;
  recipeName: string;
  meals: MealRef[];
}

export interface MealPrepWarning {
  code: "INGREDIENT_STRUCTURE_INCOMPLETE" | "NO_PRICE_DATA" | "NO_PANTRY_DATA";
  message: string;
}

export interface MealPrepPlan {
  mealPlanId: string;
  strategy: MealPrepStrategy;
  /** Anzahl unterschiedlicher Rezepte im Plan = naiver Kochvorgang-Basiswert (siehe mealPrep/batching.ts). */
  baselineCookingSessions: number;
  totalCookingSessions: number;
  prepGroups: PrepGroup[];
  soloRecipes: SoloRecipe[];
  /** Zutatenzeilen, die nicht strukturiert geparst werden konnten (siehe ingredientParser.ts) - fließen in keine Aggregation ein. */
  unparsedIngredients: { raw: string; recipeName: string }[];
  warnings: MealPrepWarning[];
  optimizationScore: number;
  scoreBreakdown: FactorResult[];
  /** Nur tatsächlich berechnete Aussagen, siehe explain.ts. */
  summary: string[];
}
