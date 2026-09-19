import type { FactorResult } from "../agents/decision/softScoring";
import type { AggregatedIngredient, MealPrepPlan, MealPrepStrategy, PrepGroup } from "./types";

/**
 * Zentrale Gewichte (Abschnitt 17), keine verstreuten Magic Numbers. Der
 * Score ist hier KEINE Auswahl unter mehreren Kandidaten (wie bei Decision
 * Engine/Meal Planner), sondern eine zusammenfassende, erklärbare
 * Qualitätskennzahl für den EINEN erzeugten Meal-Prep-Plan - nützlich, um
 * z.B. das Ergebnis unterschiedlicher Strategien für denselben Meal Plan
 * einzuordnen.
 */
export const MEAL_PREP_WEIGHTS = {
  cookingSessions: 1.0,
  ingredientReuse: 0.7,
  batchSize: 0.4,
  pantryUsage: 0.6,
  foodWaste: 0.6,
  variety: 0.3,
  freshness: 0.4,
  prepTime: 0.3,
  budget: 0.2,
} as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function scoreCookingSessions(baseline: number, total: number): FactorResult {
  const rawScore = baseline > 0 ? clamp01(1 - total / baseline) : 0;
  return {
    factor: "cookingSessions",
    weight: MEAL_PREP_WEIGHTS.cookingSessions,
    rawScore,
    weightedScore: rawScore * MEAL_PREP_WEIGHTS.cookingSessions,
    reason: total < baseline ? `${baseline - total} Kochvorgänge weniger als ohne Optimierung.` : undefined,
  };
}

function scoreIngredientReuse(aggregated: AggregatedIngredient[]): FactorResult {
  const batchable = aggregated.filter((i) => i.recipeCount >= 2);
  const rawScore = aggregated.length > 0 ? clamp01(batchable.length / aggregated.length) : 0;
  return {
    factor: "ingredientReuse",
    weight: MEAL_PREP_WEIGHTS.ingredientReuse,
    rawScore,
    weightedScore: rawScore * MEAL_PREP_WEIGHTS.ingredientReuse,
    reason: batchable.length > 0 ? `${batchable.length} Zutat(en) werden über mehrere Rezepte hinweg wiederverwendet.` : undefined,
  };
}

function scoreBatchSize(prepGroups: PrepGroup[]): FactorResult {
  const avgTasksPerGroup = prepGroups.length > 0 ? prepGroups.reduce((sum, g) => sum + g.tasks.length, 0) / prepGroups.length : 0;
  const rawScore = clamp01(avgTasksPerGroup / 3);
  return { factor: "batchSize", weight: MEAL_PREP_WEIGHTS.batchSize, rawScore, weightedScore: rawScore * MEAL_PREP_WEIGHTS.batchSize };
}

function scorePantryUsage(aggregated: AggregatedIngredient[]): FactorResult {
  const withPantry = aggregated.filter((i) => (i.pantry?.availableQuantity ?? 0) > 0);
  const rawScore = aggregated.length > 0 ? clamp01(withPantry.length / aggregated.length) : 0;
  return {
    factor: "pantryUsage",
    weight: MEAL_PREP_WEIGHTS.pantryUsage,
    rawScore,
    weightedScore: rawScore * MEAL_PREP_WEIGHTS.pantryUsage,
    reason: withPantry.length > 0 ? `${withPantry.length} Zutat(en) aus deinem Vorrat werden eingeplant.` : undefined,
  };
}

function scoreFoodWaste(aggregated: AggregatedIngredient[]): FactorResult {
  const withPantry = aggregated.filter((i) => i.pantry !== null);
  const urgent = withPantry.filter((i) => i.pantry?.urgency === "CRITICAL" || i.pantry?.urgency === "HIGH");
  const rawScore = withPantry.length > 0 ? clamp01(urgent.length / withPantry.length) : 0;
  return {
    factor: "foodWaste",
    weight: MEAL_PREP_WEIGHTS.foodWaste,
    rawScore,
    weightedScore: rawScore * MEAL_PREP_WEIGHTS.foodWaste,
    reason: urgent.length > 0 ? `Verwertet ${urgent.length} bald ablaufende Zutat(en) aus deinem Vorrat.` : undefined,
  };
}

function scoreVariety(aggregated: AggregatedIngredient[], distinctRecipeCount: number): FactorResult {
  if (aggregated.length === 0 || distinctRecipeCount === 0) {
    return { factor: "variety", weight: MEAL_PREP_WEIGHTS.variety, rawScore: 0, weightedScore: 0 };
  }
  const maxRecipeShare = Math.max(...aggregated.map((i) => i.recipeCount)) / distinctRecipeCount;
  const rawScore = clamp01(1 - maxRecipeShare);
  return { factor: "variety", weight: MEAL_PREP_WEIGHTS.variety, rawScore, weightedScore: rawScore * MEAL_PREP_WEIGHTS.variety };
}

function scoreFreshness(prepGroups: PrepGroup[], planStart: Date, planEnd: Date): FactorResult {
  const planSpanMs = Math.max(planEnd.getTime() - planStart.getTime(), 24 * 60 * 60 * 1000);
  if (prepGroups.length === 0) {
    return { factor: "freshness", weight: MEAL_PREP_WEIGHTS.freshness, rawScore: 0, weightedScore: 0 };
  }
  const avgSpanMs =
    prepGroups.reduce((sum, g) => sum + (g.latestNeededDate.getTime() - g.earliestNeededDate.getTime()), 0) / prepGroups.length;
  const rawScore = clamp01(1 - avgSpanMs / planSpanMs);
  return { factor: "freshness", weight: MEAL_PREP_WEIGHTS.freshness, rawScore, weightedScore: rawScore * MEAL_PREP_WEIGHTS.freshness };
}

function scorePrepTime(prepGroups: PrepGroup[]): FactorResult {
  if (prepGroups.length === 0) {
    return { factor: "prepTime", weight: MEAL_PREP_WEIGHTS.prepTime, rawScore: 0, weightedScore: 0 };
  }
  const avgMin = prepGroups.reduce((sum, g) => sum + g.combinedPrepTimeMin, 0) / prepGroups.length;
  const rawScore = clamp01(1 - avgMin / 90);
  return { factor: "prepTime", weight: MEAL_PREP_WEIGHTS.prepTime, rawScore, weightedScore: rawScore * MEAL_PREP_WEIGHTS.prepTime };
}

/** Neutral (0), solange keine FoodPrice-Daten vorhanden sind - nie erfundene Kosten, siehe Abschnitt 15/24. */
function scoreBudget(aggregated: AggregatedIngredient[]): FactorResult {
  const withCost = aggregated.filter((i) => i.costCents !== null);
  if (withCost.length === 0) {
    return { factor: "budget", weight: MEAL_PREP_WEIGHTS.budget, rawScore: 0, weightedScore: 0 };
  }
  const rawScore = clamp01(withCost.length / aggregated.length);
  return { factor: "budget", weight: MEAL_PREP_WEIGHTS.budget, rawScore, weightedScore: rawScore * MEAL_PREP_WEIGHTS.budget };
}

export function computeMealPrepScore(
  aggregated: AggregatedIngredient[],
  prepGroups: PrepGroup[],
  baselineCookingSessions: number,
  totalCookingSessions: number,
  distinctRecipeCount: number,
  planStart: Date,
  planEnd: Date,
): { score: number; breakdown: FactorResult[] } {
  const breakdown = [
    scoreCookingSessions(baselineCookingSessions, totalCookingSessions),
    scoreIngredientReuse(aggregated),
    scoreBatchSize(prepGroups),
    scorePantryUsage(aggregated),
    scoreFoodWaste(aggregated),
    scoreVariety(aggregated, distinctRecipeCount),
    scoreFreshness(prepGroups, planStart, planEnd),
    scorePrepTime(prepGroups),
    scoreBudget(aggregated),
  ];
  const score = breakdown.reduce((sum, f) => sum + f.weightedScore, 0);
  return { score, breakdown };
}

export type { MealPrepStrategy, MealPrepPlan };
