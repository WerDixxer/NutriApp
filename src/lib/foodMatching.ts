import type { DietType } from "@prisma/client";
import { recipeBlockedByAllergies } from "./recipes/allergens";
import type { FoodCatalog } from "./recipes/catalog";

/**
 * Gemeinsame, deterministische Matching-Bausteine für Essensplaner UND
 * Food-Assistant-Tools (recipeSearch.ts). Bewusst zentral, damit "passt zur
 * Allergie" / "passt zum Makro-Ziel" überall gleich funktioniert.
 */

/**
 * Sperrt das Rezept wegen der Allergien des Nutzers? Läuft über die zentrale
 * Auflösung in recipes/allergens.ts (Nutzer-Freitext -> kanonisches Allergen),
 * NICHT über Teilstring-Vergleiche: "Erdnüsse" muss das Rezept-Allergen
 * "erdnuss" treffen. `ingredientLines` werden zusätzlich auf Allergene geprüft
 * (gespeicherte Rezept-Allergene können unvollständig sein), `catalog` erkennt
 * dabei auch Foods, deren Name kein Allergen nennt ("Skyr" -> Milch).
 */
export function matchesAllergen(
  recipeAllergens: string[],
  profileAllergies: string[],
  ingredientLines: string[] = [],
  catalog?: FoodCatalog,
): boolean {
  return recipeBlockedByAllergies(recipeAllergens, profileAllergies, ingredientLines, catalog);
}

/**
 * Darf das Rezept diesem Profil überhaupt vorgeschlagen werden? Die harten Profilregeln ohne Kontext
 * einer Nachricht: Die Ernährungsform passt, und keine Allergie des Profils trifft das Rezept
 * (`matchesAllergen`). Gemeinsame Regel für den persönlichen Planer und die Insights (R5F-9);
 * `checkHardConstraints` (agents/decision) prüft dieselben zwei Regeln plus ausgeschlossene Zutaten
 * einzeln, um jeden Verstoß zu benennen. Die Ernährungsform wird zuerst geprüft, damit die
 * aufwendigere Allergen-Prüfung nur für passende Rezepte läuft.
 */
export function fitsProfileHardRules(
  recipe: { dietTypes: DietType[]; allergens: string[]; ingredients: string[] },
  profile: { dietType: DietType; allergies: string[] },
  catalog?: FoodCatalog,
): boolean {
  if (!recipe.dietTypes.includes(profile.dietType)) return false;
  return !matchesAllergen(recipe.allergens, profile.allergies, recipe.ingredients, catalog);
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

/**
 * Gemeinsame Grenzen der Portionsskalierung für Planer (persönlich und Haushalt) und Decision Engine:
 * höchstens 0,4x bis 2,5x des Basisrezepts. Macro Rescue (PORTION_BOUNDS) und die Größenänderung
 * im Recipe Transformer haben bewusst eigene Grenzen.
 */
export const PORTION_SCALE_BOUNDS = { min: 0.4, max: 2.5 } as const;

interface MacroVector {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Skaliert EIN Rezept so, dass es im Mittel über alle vier Makros möglichst
 * nah an ein Ziel kommt (1D-Least-Squares: s* = Σmₖ / Σmₖ², mₖ = Rezept/Ziel).
 * Genutzt von der Decision Engine, um eine sinnvolle Portionsgröße vorzuschlagen.
 */
export function computeSingleItemScale(
  target: MacroVector,
  recipe: MacroVector,
  bounds: [number, number] = [PORTION_SCALE_BOUNDS.min, PORTION_SCALE_BOUNDS.max],
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
