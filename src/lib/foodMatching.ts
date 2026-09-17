/**
 * Gemeinsame, deterministische Matching-Bausteine für Essensplaner UND
 * Food-Assistant-Tools (recipeSearch.ts). Bewusst zentral, damit "passt zur
 * Allergie" / "passt zum Makro-Ziel" überall gleich funktioniert.
 */

export function matchesAllergen(recipeAllergens: string[], profileAllergies: string[]): boolean {
  return profileAllergies.some((allergy) =>
    recipeAllergens.some(
      (a) =>
        a.toLowerCase().includes(allergy.toLowerCase()) ||
        allergy.toLowerCase().includes(a.toLowerCase()),
    ),
  );
}

/** Enthält eine der Zutaten-Zeilen den gesuchten Begriff (z.B. "gurke" in "2 Salatgurken")? */
export function ingredientListIncludes(ingredients: string[], term: string): boolean {
  const needle = term.toLowerCase();
  return ingredients.some((i) => i.toLowerCase().includes(needle));
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
