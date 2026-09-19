import { closeness, ingredientListIncludes, macroProfile } from "../foodMatching";
import { scoreFiber, type FactorResult } from "../agents/decision/softScoring";
import type { SearchableRecipe } from "../agents/recipeSearch";
import type { SlotTarget } from "./types";

/**
 * Zentral definierte Gewichte (Abschnitt 8), keine verstreuten Magic Numbers.
 * Reihenfolge folgt der im Auftrag vorgegebenen Priorität. fiber/budget
 * tragen aktuell 0 bei (siehe scoreFiber/scoreBudget unten), genau wie im
 * gleichnamigen Muster der Decision Engine (decision/softScoring.ts) - die
 * Gewichte stehen trotzdem schon hier, damit ein künftiges Nährwert-/Preis-
 * Datenfeld nur noch "scharfgeschaltet" werden muss.
 */
export const MEAL_PLAN_WEIGHTS = {
  calories: 1.0,
  protein: 0.9,
  carbs: 0.55,
  fat: 0.55,
  fiber: 0.4,
  pantry: 0.5,
  foodWaste: 0.5,
  budget: 0.35,
  prepTime: 0.2,
  preferences: 0.25,
  variety: 0.35,
  ingredientReuse: 0.25,
} as const;

export interface MealSlotScoringContext {
  slotTarget: SlotTarget;
  likedFoods: string[];
  dislikedFoods: string[];
  availablePantryIngredientNames: string[];
  urgentPantryIngredientNames: string[];
  /** null = kein aktives Budget für den Haushalt, siehe budget/budgetContext.ts. */
  remainingBudgetCents: number | null;
  /** Kombiniert historische Logs (recentRecipeCounts) und bereits im laufenden Plan verwendete Rezepte. */
  recentRecipeCount: number;
  /** Zutaten, die bereits an anderer Stelle in diesem Plan verwendet werden (Abschnitt 15). */
  usedIngredientsInPlan: Set<string>;
  /** Hauptzutaten (erste Zutat) der zuletzt (kurzes Zeitfenster) geplanten Mahlzeiten (Abschnitt 14). */
  recentMainIngredients: string[];
}

export function scoreCalories(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  const rawScore = closeness(ctx.slotTarget.kcal, candidate.kcal);
  return {
    factor: "calories",
    weight: MEAL_PLAN_WEIGHTS.calories,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.calories,
    reason: rawScore >= 0.85 ? "Passt gut zur Kalorienverteilung dieser Mahlzeit." : undefined,
  };
}

/**
 * Protein/Carbs/Fett werden über die Makro-ZUSAMMENSETZUNG (Anteil an den
 * Kalorien) bewertet, nicht über den absoluten Gramm-Wert: die Portion wird
 * später gemeinsam für den ganzen Tag skaliert (computeJointPortionScales,
 * siehe planner.ts), dabei bleibt die Zusammensetzung erhalten, der absolute
 * Wert nicht. Gleiche Überlegung wie in planner.ts:scoreRecipe dokumentiert.
 */
function scoreMacroRatio(
  factor: "protein" | "carbs" | "fat",
  candidate: SearchableRecipe,
  ctx: MealSlotScoringContext,
): FactorResult {
  const weight = MEAL_PLAN_WEIGHTS[factor];
  const recipeProfile = macroProfile(candidate.kcal, candidate.proteinG, candidate.carbsG, candidate.fatG);
  const targetProfile = macroProfile(ctx.slotTarget.kcal, ctx.slotTarget.proteinG, ctx.slotTarget.carbsG, ctx.slotTarget.fatG);
  const key = factor === "protein" ? "protein" : factor === "carbs" ? "carbs" : "fat";
  const rawScore = closeness(targetProfile[key], recipeProfile[key]);
  return {
    factor,
    weight,
    rawScore,
    weightedScore: rawScore * weight,
    reason: factor === "protein" && rawScore >= 0.85 ? "Gute Proteinquelle für diese Mahlzeit." : undefined,
  };
}

export const scoreProtein = (candidate: SearchableRecipe, ctx: MealSlotScoringContext) => scoreMacroRatio("protein", candidate, ctx);
export const scoreCarbs = (candidate: SearchableRecipe, ctx: MealSlotScoringContext) => scoreMacroRatio("carbs", candidate, ctx);
export const scoreFat = (candidate: SearchableRecipe, ctx: MealSlotScoringContext) => scoreMacroRatio("fat", candidate, ctx);

/** Recipe hat kein Ballaststoff-Feld (siehe Chapter-0/Kapitel-4-Analyse). Reine Wiederverwendung des Decision-Engine-Stubs. */
export { scoreFiber };

export function scorePantry(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  if (ctx.availablePantryIngredientNames.length === 0) {
    return { factor: "pantry", weight: MEAL_PLAN_WEIGHTS.pantry, rawScore: 0, weightedScore: 0 };
  }
  const matches = ctx.availablePantryIngredientNames.filter((ing) => ingredientListIncludes(candidate.ingredients, ing));
  const rawScore = matches.length > 0 ? Math.min(1, matches.length / 3) : 0;
  return {
    factor: "pantry",
    weight: MEAL_PLAN_WEIGHTS.pantry,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.pantry,
    reason: matches.length > 0 ? `Verwendet Vorräte, die du schon hast (${matches.join(", ")}).` : undefined,
  };
}

/** Reduziert Lebensmittelverschwendung, siehe rotation/rotationEngine.ts (CRITICAL/HIGH Dringlichkeit). Keine zweite Food-Waste-Logik. */
export function scoreFoodWaste(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  if (ctx.urgentPantryIngredientNames.length === 0) {
    return { factor: "foodWaste", weight: MEAL_PLAN_WEIGHTS.foodWaste, rawScore: 0, weightedScore: 0 };
  }
  const matches = ctx.urgentPantryIngredientNames.filter((ing) => ingredientListIncludes(candidate.ingredients, ing));
  const rawScore = matches.length > 0 ? 1 : 0;
  return {
    factor: "foodWaste",
    weight: MEAL_PLAN_WEIGHTS.foodWaste,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.foodWaste,
    reason: matches.length > 0 ? `Verwertet bald ablaufende Lebensmittel (${matches.join(", ")}).` : undefined,
  };
}

/**
 * Kein reales Preis-pro-Rezept-Modell (Recipe.ingredients ist unstrukturierter
 * Freitext, siehe budget/mealCost.ts-Kommentar aus Kapitel 8). Ein fehlender
 * Preis wird NIE als 0€ behandelt - der Faktor bleibt konsequent neutral,
 * unabhängig davon, ob überhaupt ein Budget gesetzt ist.
 */
export function scoreBudget(): FactorResult {
  return { factor: "budget", weight: MEAL_PLAN_WEIGHTS.budget, rawScore: 0, weightedScore: 0 };
}

export function scorePrepTime(candidate: SearchableRecipe, maxCookingTimeMin?: number): FactorResult {
  const limit = maxCookingTimeMin ?? 40;
  const rawScore = Math.max(0, Math.min(1, 1 - candidate.prepTimeMin / (limit * 1.5)));
  return {
    factor: "prepTime",
    weight: MEAL_PLAN_WEIGHTS.prepTime,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.prepTime,
    reason: candidate.prepTimeMin <= limit ? "Schnell zubereitet." : undefined,
  };
}

export function scorePreferences(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  const likedHit = ctx.likedFoods.some((f) => ingredientListIncludes(candidate.ingredients, f));
  const dislikedHit = ctx.dislikedFoods.some((f) => ingredientListIncludes(candidate.ingredients, f));
  let rawScore = 0;
  if (likedHit) rawScore += 0.7;
  if (dislikedHit) rawScore -= 0.7;
  rawScore = Math.max(-1, Math.min(1, rawScore));
  return {
    factor: "preferences",
    weight: MEAL_PLAN_WEIGHTS.preferences,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.preferences,
    reason: likedHit ? "Enthält Zutaten, die du magst." : undefined,
  };
}

/** Bestraft ein kürzlich (historisch geloggt ODER bereits in diesem Plan) verwendetes Rezept. Gleiche Abklingkurve wie decision/softScoring.ts:scoreVariety. */
export function scoreVariety(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  const recipeRepeatScore = ctx.recentRecipeCount === 0 ? 1 : Math.max(0, 1 - ctx.recentRecipeCount * 0.4);

  const mainIngredient = mainIngredientToken(candidate.ingredients);
  const mainIngredientRepeated = mainIngredient !== null && ctx.recentMainIngredients.includes(mainIngredient);
  const rawScore = mainIngredientRepeated ? recipeRepeatScore * 0.6 : recipeRepeatScore;

  return {
    factor: "variety",
    weight: MEAL_PLAN_WEIGHTS.variety,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.variety,
    reason: rawScore >= 0.95 ? "Bringt Abwechslung zu den letzten Mahlzeiten." : undefined,
  };
}

/** Bonus, wenn eine Zutat bereits anderswo im Plan verwendet wird (weniger Einkaufsaufwand/Waste), siehe Abschnitt 15. */
export function scoreIngredientReuse(candidate: SearchableRecipe, ctx: MealSlotScoringContext): FactorResult {
  if (ctx.usedIngredientsInPlan.size === 0) {
    return { factor: "ingredientReuse", weight: MEAL_PLAN_WEIGHTS.ingredientReuse, rawScore: 0, weightedScore: 0 };
  }
  const matches = candidate.ingredients.filter((ing) =>
    Array.from(ctx.usedIngredientsInPlan).some((used) => ing.toLowerCase().includes(used.toLowerCase())),
  );
  const rawScore = matches.length > 0 ? Math.min(1, matches.length / 2) : 0;
  return {
    factor: "ingredientReuse",
    weight: MEAL_PLAN_WEIGHTS.ingredientReuse,
    rawScore,
    weightedScore: rawScore * MEAL_PLAN_WEIGHTS.ingredientReuse,
    reason: matches.length > 0 ? "Nutzt Zutaten weiter, die diese Woche schon eingeplant sind." : undefined,
  };
}

/** Erste Zutatenzeile als grobe, deterministische "Hauptzutat" (z.B. "200g Hähnchenbrust" -> "hähnchenbrust"-artiger Token). Keine erfundene Klassifikation. */
export function mainIngredientToken(ingredients: string[]): string | null {
  const first = ingredients[0];
  if (!first) return null;
  return first.toLowerCase().replace(/^[\d.,]+\s*(g|kg|ml|l|stück|el|tl)?\s*/i, "").trim() || null;
}

const FACTORS: Array<(candidate: SearchableRecipe, ctx: MealSlotScoringContext) => FactorResult> = [
  scoreCalories,
  scoreProtein,
  scoreCarbs,
  scoreFat,
  () => scoreFiber(),
  scorePantry,
  scoreFoodWaste,
  scoreBudget,
  scorePreferences,
  scoreVariety,
  scoreIngredientReuse,
];

export function scoreCandidate(
  candidate: SearchableRecipe,
  ctx: MealSlotScoringContext,
  maxCookingTimeMin?: number,
): { total: number; factorResults: FactorResult[] } {
  const factorResults = FACTORS.map((fn) => fn(candidate, ctx));
  factorResults.push(scorePrepTime(candidate, maxCookingTimeMin));
  const total = factorResults.reduce((sum, f) => sum + f.weightedScore, 0);
  return { total, factorResults };
}
