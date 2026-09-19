import type { AggregatedIngredient, PrepGroup, SoloRecipe } from "./types";

/**
 * Baut die Zusammenfassung ausschließlich aus tatsächlich berechneten
 * Tatsachen (Abschnitt 20) - keine erfundene Zeitersparnis (Abschnitt 24),
 * keine Haltbarkeitsaussage (Abschnitt 12).
 */
export function buildSummary(
  baselineCookingSessions: number,
  totalCookingSessions: number,
  prepGroups: PrepGroup[],
  soloRecipes: SoloRecipe[],
  aggregated: AggregatedIngredient[],
): string[] {
  const lines: string[] = [];

  if (totalCookingSessions < baselineCookingSessions) {
    lines.push(`${totalCookingSessions} Kochvorgänge statt ${baselineCookingSessions}.`);
  } else {
    lines.push(`${baselineCookingSessions} Kochvorgänge, keine sinnvolle Bündelung gefunden.`);
  }

  for (const group of prepGroups) {
    const mealCount = new Set(group.tasks.flatMap((t) => t.usedForMeals.map((m) => m.mealId))).size;
    if (group.tasks.length > 1) {
      lines.push(`${group.name}: bündelt ${group.tasks.length} Zutaten für ${mealCount} Mahlzeiten in einem Kochvorgang.`);
    }
  }

  const usedFromPantry = aggregated.filter((i) => (i.pantry?.availableQuantity ?? 0) > 0);
  for (const ingredient of usedFromPantry) {
    lines.push(
      `${formatQuantity(ingredient.pantry!.availableQuantity)} ${ingredient.unit.toLowerCase()} ${ingredient.displayName} aus deinem Vorrat werden eingeplant.`,
    );
  }

  const urgent = aggregated.filter((i) => i.pantry?.urgency === "CRITICAL" || i.pantry?.urgency === "HIGH");
  if (urgent.length > 0) {
    lines.push(`Reduziert Lebensmittelverschwendung bei: ${urgent.map((i) => i.displayName).join(", ")}.`);
  }

  if (soloRecipes.length > 0) {
    lines.push(`${soloRecipes.length} Rezept(e) bleiben eigenständig, keine gemeinsame Zutat mit anderen Mahlzeiten.`);
  }

  return lines;
}

function formatQuantity(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}
