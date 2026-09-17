import type { SearchableRecipe } from "../recipeSearch";

/**
 * Harte Vorbedingung: ohne gültige Kern-Nährwerte (kcal/Protein/Carbs/Fett)
 * ist ein Kandidat für Macro Rescue nicht bewertbar. Er wird komplett
 * ausgeschlossen, niemals mit einem erfundenen 0-Wert weitergerechnet.
 */
export function hasValidCoreNutrition(candidate: SearchableRecipe): boolean {
  const core = [candidate.kcal, candidate.proteinG, candidate.carbsG, candidate.fatG];
  return core.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);
}
