import { ingredientListIncludes } from "../../foodMatching";
import type { SearchableRecipe } from "../recipeSearch";

export const VARIETY_WINDOW_DAYS = 7;

export interface ScoringContext {
  targetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  /** Nur gesetzt, wenn der Nutzer explizit eine Zeitgrenze genannt hat. */
  maxCookingTimeMin?: number;
  /** Zutaten, die der Nutzer in der Nachricht genannt hat ("ich habe noch..."). Kein echtes Pantry-Modell vor Kapitel 6. */
  availableIngredients?: string[];
  likedFoods: string[];
  dislikedFoods: string[];
  preferences: string[];
  /** recipeId -> Anzahl Logs in den letzten VARIETY_WINDOW_DAYS Tagen. */
  recentRecipeCounts: Map<string, number>;
  /** Namen von Pantry Items mit CRITICAL/HIGH Rotation-Dringlichkeit (Kapitel 7), siehe scoreFoodWaste. */
  urgentPantryIngredientNames?: string[];
}

export interface FactorResult {
  factor: string;
  weight: number;
  /** 0..1 für reine Nähe-Scores, -1..1 wo eine Abneigung explizit bestraft wird (preferences). */
  rawScore: number;
  weightedScore: number;
  /** Nur gesetzt, wenn der Faktor tatsächlich etwas Nennenswertes beigetragen hat (Grundlage für Explainability). */
  reason?: string;
}

/**
 * Zentral definierte Gewichtungen, absteigend nach der vorgegebenen
 * Prioritätsreihenfolge (Kalorien > Makros > Ballaststoffe > Haltbarkeit/
 * Food Waste > Budget > Zubereitungszeit > Vorräte > Präferenzen >
 * Abwechslung). fiber/foodWaste/budget sind aktuell 0-Faktoren (siehe
 * jeweilige Funktion unten, Datenquelle fehlt noch), die Gewichte stehen
 * trotzdem schon hier, damit spätere Kapitel sie nur noch "scharfschalten"
 * statt neu in die Prioritätsreihenfolge einsortieren müssen.
 */
export const SOFT_WEIGHTS = {
  calories: 1.0,
  macros: 0.8,
  fiber: 0.5,
  foodWaste: 0.45,
  budget: 0.4,
  prepTime: 0.3,
  pantry: 0.25,
  preferences: 0.2,
  variety: 0.15,
} as const;

function closeness(target: number, actual: number): number {
  if (target <= 0) return actual <= 0 ? 1 : 0;
  const diff = Math.abs(target - actual) / target;
  return Math.max(0, 1 - diff);
}

export function scoreCalories(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  const rawScore = closeness(ctx.targetKcal, candidate.kcal);
  return {
    factor: "calories",
    weight: SOFT_WEIGHTS.calories,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.calories,
    reason: rawScore >= 0.85 ? "Passt gut zu deinem Kalorienziel." : undefined,
  };
}

export function scoreMacros(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  const protein = closeness(ctx.targetProteinG, candidate.proteinG);
  const carbs = closeness(ctx.targetCarbsG, candidate.carbsG);
  const fat = closeness(ctx.targetFatG, candidate.fatG);
  const rawScore = (protein + carbs + fat) / 3;
  return {
    factor: "macros",
    weight: SOFT_WEIGHTS.macros,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.macros,
    reason: protein >= 0.85 ? "Enthält ausreichend Protein für dein Ziel." : undefined,
  };
}

/** Noch keine Ballaststoff-Daten am Rezept-Modell (siehe Chapter-0-Analyse). Faktor bleibt neutral statt erfunden. */
export function scoreFiber(): FactorResult {
  return { factor: "fiber", weight: SOFT_WEIGHTS.fiber, rawScore: 0, weightedScore: 0 };
}

/**
 * Seit Kapitel 7 scharf: belohnt Rezepte, die ein Pantry Item mit
 * CRITICAL/HIGH Rotation-Dringlichkeit verwerten (echte Werte aus der Food
 * Rotation Engine, siehe rotation/rotationEngine.ts). Ohne Haushalt/ohne
 * dringende Items bleibt der Faktor weiterhin neutral, nichts wird erfunden.
 */
export function scoreFoodWaste(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  if (!ctx.urgentPantryIngredientNames || ctx.urgentPantryIngredientNames.length === 0) {
    return { factor: "foodWaste", weight: SOFT_WEIGHTS.foodWaste, rawScore: 0, weightedScore: 0 };
  }
  const matches = ctx.urgentPantryIngredientNames.filter((ing) => ingredientListIncludes(candidate.ingredients, ing));
  const rawScore = matches.length > 0 ? 1 : 0;
  return {
    factor: "foodWaste",
    weight: SOFT_WEIGHTS.foodWaste,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.foodWaste,
    reason: matches.length > 0 ? `Verwertet Lebensmittel, die bald ablaufen (${matches.join(", ")}).` : undefined,
  };
}

/** Noch kein Preis-/Budget-Modell (Kapitel 8). Faktor bleibt neutral statt erfunden. */
export function scoreBudget(): FactorResult {
  return { factor: "budget", weight: SOFT_WEIGHTS.budget, rawScore: 0, weightedScore: 0 };
}

export function scorePrepTime(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  // Ohne explizite Vorgabe: milde Präferenz für Alltagstaugliches (Richtwert 30 Min), kein hartes Limit.
  const limit = ctx.maxCookingTimeMin ?? 30;
  const rawScore = Math.max(0, Math.min(1, 1 - candidate.prepTimeMin / (limit * 1.5)));
  return {
    factor: "prepTime",
    weight: SOFT_WEIGHTS.prepTime,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.prepTime,
    reason:
      ctx.maxCookingTimeMin !== undefined && candidate.prepTimeMin <= ctx.maxCookingTimeMin
        ? "Ist in deiner gewünschten Zeit zubereitet."
        : undefined,
  };
}

export function scorePantry(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  if (!ctx.availableIngredients || ctx.availableIngredients.length === 0) {
    // Kein Pantry-Kontext in dieser Anfrage: neutral, nicht erfunden.
    return { factor: "pantry", weight: SOFT_WEIGHTS.pantry, rawScore: 0, weightedScore: 0 };
  }
  const matches = ctx.availableIngredients.filter((ing) => ingredientListIncludes(candidate.ingredients, ing));
  const rawScore = matches.length / ctx.availableIngredients.length;
  return {
    factor: "pantry",
    weight: SOFT_WEIGHTS.pantry,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.pantry,
    reason: matches.length > 0 ? `Verwendet Zutaten, die du bereits hast (${matches.join(", ")}).` : undefined,
  };
}

export function scorePreferences(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  const likedHit = ctx.likedFoods.some((f) => ingredientListIncludes(candidate.ingredients, f));
  const dislikedHit = ctx.dislikedFoods.some((f) => ingredientListIncludes(candidate.ingredients, f));
  const haystack = `${candidate.name} ${candidate.description} ${candidate.tags.join(" ")}`.toLowerCase();
  const prefHits = ctx.preferences.filter((p) => haystack.includes(p.toLowerCase()));

  let rawScore = 0;
  if (likedHit) rawScore += 0.6;
  if (prefHits.length > 0) rawScore += 0.4;
  if (dislikedHit) rawScore -= 0.6;
  rawScore = Math.max(-1, Math.min(1, rawScore));

  return {
    factor: "preferences",
    weight: SOFT_WEIGHTS.preferences,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.preferences,
    reason: likedHit || prefHits.length > 0 ? "Passt zu deinen Präferenzen." : undefined,
  };
}

export function scoreVariety(candidate: SearchableRecipe, ctx: ScoringContext): FactorResult {
  const recentCount = ctx.recentRecipeCounts.get(candidate.id) ?? 0;
  const rawScore = recentCount === 0 ? 1 : Math.max(0, 1 - recentCount * 0.4);
  return {
    factor: "variety",
    weight: SOFT_WEIGHTS.variety,
    rawScore,
    weightedScore: rawScore * SOFT_WEIGHTS.variety,
  };
}

const FACTORS = [
  scoreCalories,
  scoreMacros,
  scoreFiber,
  scoreFoodWaste,
  scoreBudget,
  scorePrepTime,
  scorePantry,
  scorePreferences,
  scoreVariety,
];

export function scoreCandidate(
  candidate: SearchableRecipe,
  ctx: ScoringContext,
): { total: number; factorResults: FactorResult[] } {
  const factorResults = FACTORS.map((fn) => fn(candidate, ctx));
  const total = factorResults.reduce((sum, f) => sum + f.weightedScore, 0);
  return { total, factorResults };
}
