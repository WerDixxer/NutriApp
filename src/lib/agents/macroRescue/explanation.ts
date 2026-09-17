import type { MacroDeviation, MacroActualInput } from "./loss";

const MACRO_LABELS: Record<MacroDeviation["macro"], string> = {
  calories: "Kalorien",
  protein: "Protein",
  carbs: "Kohlenhydrate",
  fat: "Fett",
  fiber: "Ballaststoffe",
};

function formatPortion(portionMultiplier: number): string {
  if (Math.abs(portionMultiplier - 1) < 0.05) return "einer Portion";
  return `${portionMultiplier.toFixed(2).replace(/0$/, "").replace(".", ",")} Portionen`;
}

function describeWorstDeviation(deviations: MacroDeviation[]): string | null {
  const included = deviations.filter((d) => d.included);
  if (included.length === 0) return null;
  const worst = included.reduce((a, b) => (b.relativeDeviation > a.relativeDeviation ? b : a));
  if (worst.relativeDeviation <= 0.01) return null;
  const pct = Math.round(worst.relativeDeviation * 100);
  const direction = worst.actual > worst.target ? "über" : "unter";
  return `${MACRO_LABELS[worst.macro]} liegt ${pct}% ${direction} dem Rest`;
}

/**
 * Baut den Erklärungssatz ausschließlich aus tatsächlich berechneten Werten
 * (portionMultiplier, actual, deviations), keine zusätzlichen Behauptungen.
 */
export function buildRescueExplanation(
  recipeName: string,
  portionMultiplier: number,
  actual: MacroActualInput,
  deviations: MacroDeviation[],
): string {
  const included = deviations.filter((d) => d.included);
  const allWithinTolerance = included.length > 0 && included.every((d) => d.withinTolerance);

  const closing = allWithinTolerance
    ? "und liegt damit sehr nah an deinen verbleibenden Zielen."
    : (() => {
        const worst = describeWorstDeviation(deviations);
        return worst ? `die größte Abweichung: ${worst}.` : "als beste verfügbare Annäherung.";
      })();

  return `${recipeName} bringt dich mit ${formatPortion(portionMultiplier)} auf ca. ${Math.round(actual.calories)} kcal und ${actual.protein}g Protein, ${closing}`;
}
