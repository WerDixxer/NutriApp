import type { MacroLossWeights } from "./lossWeights";
import type { MacroTolerances } from "./tolerances";

export type MacroName = "calories" | "protein" | "carbs" | "fat" | "fiber";

export interface MacroTargetsInput {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Optional, wie im Auftrag ("optional verbleibende Ballaststoffe"). */
  fiber?: number;
}

export interface MacroActualInput {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Aktuell nie vorhanden (kein Fiber-Feld am Rezept-Modell), Platzhalter für spätere Nutrition-Engine-Erweiterung. */
  fiber?: number;
}

export interface MacroDeviation {
  macro: MacroName;
  target: number;
  actual: number;
  /** |target-actual|/target, 0 = exakter Treffer. */
  relativeDeviation: number;
  withinTolerance: boolean;
  /** max(0, relativeDeviation - tolerance) * weight. Innerhalb der Toleranz immer 0. */
  loss: number;
  /** false, wenn Ziel oder Ist-Wert nicht verfügbar war, dieser Makro also gar nicht bewertet wurde. */
  included: boolean;
}

export interface LossResult {
  totalLoss: number;
  deviations: MacroDeviation[];
}

function relativeDeviation(target: number, actual: number): number {
  if (target <= 0) return actual <= 0 ? 0 : 1;
  return Math.abs(target - actual) / target;
}

function evaluateMacro(
  macro: MacroName,
  target: number | undefined,
  actual: number | undefined,
  tolerance: number,
  weight: number,
): MacroDeviation {
  // Fehlende Ziel- oder Ist-Werte werden NIE als 0 interpretiert, der Makro
  // wird stattdessen sauber als "nicht bewertet" markiert und trägt nichts
  // zum Loss bei (weder positiv noch negativ).
  if (target === undefined || actual === undefined || !Number.isFinite(actual) || !Number.isFinite(target)) {
    return {
      macro,
      target: target ?? 0,
      actual: actual ?? 0,
      relativeDeviation: 0,
      withinTolerance: true,
      loss: 0,
      included: false,
    };
  }

  const deviation = relativeDeviation(target, actual);
  const withinTolerance = deviation <= tolerance;
  const loss = Math.max(0, deviation - tolerance) * weight;

  return { macro, target, actual, relativeDeviation: deviation, withinTolerance, loss, included: true };
}

/**
 * Deterministische Loss-Funktion über alle Makros gemeinsam (nicht nur
 * Kalorien). Innerhalb der konfigurierten Toleranz trägt ein Makro nichts
 * zum Loss bei ("getroffen"), außerhalb wächst der Loss proportional zur
 * Überschreitung, gewichtet nach `weights`. Niedrigerer totalLoss = bessere
 * Lösung. 0 = alle bewerteten Makros exakt oder innerhalb Toleranz getroffen.
 */
export function computeMacroLoss(
  targets: MacroTargetsInput,
  actual: MacroActualInput,
  tolerances: MacroTolerances,
  weights: MacroLossWeights,
): LossResult {
  const deviations: MacroDeviation[] = [
    evaluateMacro("calories", targets.calories, actual.calories, tolerances.caloriesPct, weights.calories),
    evaluateMacro("protein", targets.protein, actual.protein, tolerances.proteinPct, weights.protein),
    evaluateMacro("carbs", targets.carbs, actual.carbs, tolerances.carbsPct, weights.carbs),
    evaluateMacro("fat", targets.fat, actual.fat, tolerances.fatPct, weights.fat),
    evaluateMacro("fiber", targets.fiber, actual.fiber, tolerances.fiberPct, weights.fiber),
  ];

  const totalLoss = deviations.reduce((sum, d) => sum + d.loss, 0);
  return { totalLoss, deviations };
}
