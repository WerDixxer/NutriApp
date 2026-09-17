import { computeMacroLoss, type MacroActualInput, type MacroTargetsInput } from "./loss";
import type { MacroLossWeights } from "./lossWeights";
import type { MacroTolerances } from "./tolerances";

/** Realistische Grenzen für die Portionsskalierung. Kein beliebiges Hoch-/Runterskalieren. */
export const PORTION_BOUNDS = { min: 0.5, max: 2.5 } as const;
const PORTION_STEP = 0.05;

const ZERO_TOLERANCES: MacroTolerances = { caloriesPct: 0, proteinPct: 0, carbsPct: 0, fatPct: 0, fiberPct: 0 };

/**
 * Sucht deterministisch die Portionsgröße (in `PORTION_BOUNDS`, Schrittweite
 * `PORTION_STEP`), die den Loss aus loss.ts minimiert, statt eine von der
 * eigentlichen Zielfunktion losgelöste separate Formel zu verwenden. Ein
 * einfaches, begrenztes Grid statt eines analytischen Lösers, weil der Loss
 * durch die Toleranzbänder stückweise linear und nicht überall glatt ist,
 * damit bleibt die Suche einfach, nachvollziehbar und garantiert innerhalb
 * der Grenzen.
 *
 * Primäres Kriterium ist der reguläre (toleranzbehaftete) Loss. Weil
 * innerhalb der Toleranzbänder ein ganzes Band von Portionsgrößen denselben
 * (0-)Loss erreichen kann, entscheidet als zweites Kriterium der Loss ohne
 * Toleranz (reine relative Abweichung), damit innerhalb eines gleich guten
 * Bands trotzdem die Portion gewinnt, die dem Ziel tatsächlich am nächsten
 * kommt, nicht zufällig die kleinste zuerst gefundene.
 */
export function findOptimalPortion(
  base: MacroActualInput,
  targets: MacroTargetsInput,
  tolerances: MacroTolerances,
  weights: MacroLossWeights,
  bounds: { min: number; max: number } = PORTION_BOUNDS,
): number {
  let bestScale = bounds.min;
  let bestPrimary = Infinity;
  let bestSecondary = Infinity;

  for (let scale = bounds.min; scale <= bounds.max + 1e-9; scale += PORTION_STEP) {
    const scaled: MacroActualInput = {
      calories: base.calories * scale,
      protein: base.protein * scale,
      carbs: base.carbs * scale,
      fat: base.fat * scale,
      fiber: base.fiber !== undefined ? base.fiber * scale : undefined,
    };
    const primary = computeMacroLoss(targets, scaled, tolerances, weights).totalLoss;
    const secondary = computeMacroLoss(targets, scaled, ZERO_TOLERANCES, weights).totalLoss;

    const better =
      primary < bestPrimary - 1e-9 || (Math.abs(primary - bestPrimary) <= 1e-9 && secondary < bestSecondary - 1e-9);
    if (better) {
      bestPrimary = primary;
      bestSecondary = secondary;
      bestScale = scale;
    }
  }

  return Math.round(bestScale * 100) / 100;
}
