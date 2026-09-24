import type { RecipeDetail } from "@/components/RecipeDetailModal";
import { approxGrams, approxKcal } from "../format";
import type { PersonalizedVariant, SwapReason } from "./personalization";

/**
 * Was der Rezept-Dialog für "Original" und "Für dich angepasst" anzeigt. Reine Funktionen ohne
 * Zustand: der Dialog hält nur die Wahl des Nutzers, alles Übrige folgt aus den Daten.
 */

/** Die Variante, sofern es wirklich etwas zu ersetzen gibt; sonst null (dann bleibt die normale Ansicht). */
export function availableVariant(recipe: Pick<RecipeDetail, "variant">): PersonalizedVariant | null {
  const variant = recipe.variant;
  return variant && variant.replacements.length > 0 ? variant : null;
}

export interface DetailView {
  ingredients: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Zutaten und Nährwerte der gewählten Ansicht. Ohne Variante immer das Original. */
export function detailView(recipe: RecipeDetail, personalized: boolean): DetailView {
  const variant = availableVariant(recipe);
  if (personalized && variant) {
    return {
      ingredients: variant.ingredientLines,
      kcal: variant.kcal,
      proteinG: variant.proteinG,
      carbsG: variant.carbsG,
      fatG: variant.fatG,
    };
  }
  return { ingredients: recipe.ingredients, kcal: recipe.kcal, proteinG: recipe.proteinG, carbsG: recipe.carbsG, fatG: recipe.fatG };
}

const REASON_TEXT: Record<SwapReason, (from: string) => string> = {
  disliked_food: (from) => `Du magst ${from} nicht`,
  allergen: () => "Wegen deiner Allergie oder Unverträglichkeit",
  favorite_food: () => "Passt zu deinen Lieblingsfoods",
};

export interface ReplacementRow {
  /** "Skyr → Magerquark" */
  title: string;
  /** "100 g → 100 g": gleiche Menge und Einheit, ausdrücklich gezeigt. Null ohne Mengenangabe. */
  quantity: string | null;
  reason: string;
}

export function replacementRows(variant: PersonalizedVariant): ReplacementRow[] {
  return variant.replacements.map((r) => ({
    title: `${r.fromName} → ${r.toName}`,
    quantity: r.quantity ? `${r.quantity} → ${r.quantity}` : null,
    reason: REASON_TEXT[r.reason](r.fromName),
  }));
}

/** Kurzer Hinweis vor der Entscheidung: "Möglich: Magerquark statt Skyr". */
export function variantTeaser(variant: PersonalizedVariant): string {
  return `Möglich: ${variant.replacements.map((r) => `${r.toName} statt ${r.fromName}`).join(", ")}`;
}

/** "~360 kcal · ~26 g Protein" */
export function nutritionSummary(n: { kcal: number; proteinG: number }): string {
  return `${approxKcal(n.kcal)} · ${approxGrams(n.proteinG)} Protein`;
}
