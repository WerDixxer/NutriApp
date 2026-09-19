import type { CatalogFood, RecipeUnit, StructuredIngredient } from "./types";

/**
 * Gewicht einer Zutatenmenge in Gramm - Grundlage jeder Nährwertberechnung.
 * Gibt `null` zurück, wenn es keine belastbare Umrechnung gibt (fehlende
 * Menge, Einheit ohne hinterlegte Grammzahl), statt ein Gewicht zu raten.
 * Dasselbe Prinzip wie pantry/units.ts:convertQuantity().
 */
export function ingredientGrams(
  ingredient: Pick<StructuredIngredient, "amount" | "unit" | "gramsOverride">,
  food: Pick<CatalogFood, "unitGrams">,
): number | null {
  if (ingredient.amount === null || ingredient.unit === null) return null;
  if (ingredient.gramsOverride !== undefined) return ingredient.gramsOverride;

  const { amount, unit } = ingredient;
  switch (unit) {
    case "g":
      return amount;
    case "ml":
      return amount * (food.unitGrams?.ml ?? 1);
    case "tl":
    case "el":
    case "piece":
    case "slice":
    case "can": {
      const perUnit = food.unitGrams?.[unit];
      return perUnit === undefined ? null : amount * perUnit;
    }
    case "pinch":
      return null;
  }
}

const UNIT_LABEL: Record<RecipeUnit, (amount: number) => string> = {
  g: () => "g",
  ml: () => "ml",
  tl: () => "TL",
  el: () => "EL",
  piece: () => "",
  slice: (n) => (n === 1 ? "Scheibe" : "Scheiben"),
  can: (n) => (n === 1 ? "Dose" : "Dosen"),
  pinch: (n) => (n === 1 ? "Prise" : "Prisen"),
};

const FRACTIONS: Record<number, string> = { 0.25: "1/4", 0.5: "1/2", 0.75: "3/4" };

/** "2", "1/2", "1,5" - Brüche nur unter 1, damit scaleIngredientText() sie wieder lesen kann. */
export function formatAmount(amount: number): string {
  if (FRACTIONS[amount]) return FRACTIONS[amount];
  const rounded = Math.round(amount * 100) / 100;
  return String(rounded).replace(".", ",");
}

/**
 * Baut die Freitext-Zeile, die die bestehenden Konsumenten (Planner,
 * Soft-Scoring, Meal Prep, Detailansicht) aus `Recipe.ingredients` lesen:
 * "100 g Skyr", "2 Scheiben Vollkornbrot", "1 Ei", "Salz", "Süße (optional)".
 */
export function formatIngredientLine(
  ingredient: Pick<StructuredIngredient, "amount" | "unit" | "displayName" | "optional" | "note">,
): string {
  const parts: string[] = [];
  if (ingredient.amount !== null && ingredient.unit !== null) {
    parts.push(formatAmount(ingredient.amount));
    const label = UNIT_LABEL[ingredient.unit](ingredient.amount);
    if (label) parts.push(label);
  }
  parts.push(ingredient.displayName);

  let line = parts.join(" ");
  if (ingredient.note) line += ` (${ingredient.note})`;
  if (ingredient.optional) line += " (optional)";
  return line;
}
