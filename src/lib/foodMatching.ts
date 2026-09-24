import { recipeBlockedByAllergies } from "./recipes/allergens";

/**
 * Gemeinsame, deterministische Matching-Bausteine für Essensplaner UND
 * Food-Assistant-Tools (recipeSearch.ts). Bewusst zentral, damit "passt zur
 * Allergie" / "passt zum Makro-Ziel" überall gleich funktioniert.
 */

/**
 * Sperrt das Rezept wegen der Allergien des Nutzers? Läuft über die zentrale
 * Auflösung in recipes/allergens.ts (Nutzer-Freitext -> kanonisches Allergen),
 * NICHT über Teilstring-Vergleiche: "Erdnüsse" muss das Rezept-Allergen
 * "erdnuss" treffen. `ingredientLines` (optional) erlaubt für Begriffe, die
 * nicht im Allergen-Vokabular stehen, einen Textabgleich gegen die Zutaten,
 * damit ein unbekanntes Allergen nie als sicher durchgeht.
 */
export function matchesAllergen(recipeAllergens: string[], profileAllergies: string[], ingredientLines: string[] = []): boolean {
  return recipeBlockedByAllergies(recipeAllergens, profileAllergies, ingredientLines);
}

/** Enthält eine der Zutaten-Zeilen den gesuchten Begriff (z.B. "gurke" in "2 Salatgurken")? */
export function ingredientListIncludes(ingredients: string[], term: string): boolean {
  const needle = term.toLowerCase();
  return ingredients.some((i) => i.toLowerCase().includes(needle));
}

/**
 * 0..1-Nähe-Score zwischen einem Zielwert und einem tatsächlichen Wert (1 =
 * exakt getroffen, 0 = mindestens so weit daneben wie der Zielwert selbst).
 * Gemeinsamer Baustein für Decision Engine UND Meal Planner (Kapitel 10),
 * siehe jeweilige scoreCalories/scoreProtein etc.
 */
export function closeness(target: number, actual: number): number {
  if (target <= 0) return actual <= 0 ? 1 : 0;
  const diff = Math.abs(target - actual) / target;
  return Math.max(0, 1 - diff);
}

/** Anteil der Kalorien, die aus Protein/Carbs/Fett stammen (Makro-"Fingerabdruck"). */
export function macroProfile(kcal: number, proteinG: number, carbsG: number, fatG: number) {
  const safeKcal = Math.max(kcal, 1);
  return {
    protein: (proteinG * 4) / safeKcal,
    carbs: (carbsG * 4) / safeKcal,
    fat: (fatG * 9) / safeKcal,
  };
}

interface MacroVector {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Skaliert EIN Rezept so, dass es im Mittel über alle vier Makros möglichst
 * nah an ein Ziel kommt (1D-Least-Squares: s* = Σmₖ / Σmₖ², mₖ = Rezept/Ziel).
 * Genutzt z.B. von Macro Rescue, um eine sinnvolle Portionsgröße vorzuschlagen.
 */
export function computeSingleItemScale(
  target: MacroVector,
  recipe: MacroVector,
  bounds: [number, number] = [0.4, 2.5],
): number {
  const keys = ["kcal", "proteinG", "carbsG", "fatG"] as const;
  let numerator = 0;
  let denominator = 0;
  for (const k of keys) {
    const t = Math.max(target[k], 1);
    const m = recipe[k] / t;
    numerator += m;
    denominator += m * m;
  }
  const raw = denominator > 1e-9 ? numerator / denominator : 1;
  return Math.min(Math.max(raw, bounds[0]), bounds[1]);
}
