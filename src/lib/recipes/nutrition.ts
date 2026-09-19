import type { FoodCatalog } from "./catalog";
import type { NutritionPerServing, StructuredIngredient } from "./types";
import { ingredientGrams } from "./units";

export interface UnresolvedIngredient {
  displayName: string;
  reason: "unknown-food" | "no-unit-conversion" | "no-nutrition";
}

export interface NutritionResult {
  perServing: NutritionPerServing;
  /** false, sobald mindestens eine Zutat MIT Menge nicht berechnet werden konnte (siehe `unresolved`). */
  complete: boolean;
  unresolved: UnresolvedIngredient[];
  /** Zutaten ohne Mengenangabe ("nach Geschmack") - fließen bewusst nicht ein, statt eine Menge zu erfinden. */
  unquantified: string[];
}

const ZERO: NutritionPerServing = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  fiberG: 0,
  sugarG: 0,
  saturatedFatG: 0,
  sodiumMg: 0,
};

/**
 * Recipe -> Recipe Ingredients -> Food -> Nährwerte je 100 g. Die festen
 * Spalten auf `Recipe` sind nur der Snapshot dieses Ergebnisses; wird eine
 * Zutat durch eine Alternative ersetzt (personalization.ts), läuft dieselbe
 * Funktion mit dem gewählten Food neu, die Nährwerte bleiben also nicht
 * stillschweigend die des Originals.
 *
 * Nicht eingerechnet werden: als `optional` markierte Zutaten, Foods mit
 * `negligible` (Gewürze) und Zutaten ohne Mengenangabe. Alles Übrige, das
 * sich nicht berechnen lässt, landet in `unresolved` und macht das Ergebnis
 * als unvollständig kenntlich, statt Nullen als Messwert auszugeben.
 */
export function computeRecipeNutrition(
  ingredients: StructuredIngredient[],
  servings: number,
  catalog: FoodCatalog,
): NutritionResult {
  const total = { ...ZERO };
  const unresolved: UnresolvedIngredient[] = [];
  const unquantified: string[] = [];

  for (const ingredient of ingredients) {
    if (ingredient.optional) continue;

    const food = catalog.get(ingredient.foodId);
    if (!food) {
      unresolved.push({ displayName: ingredient.displayName, reason: "unknown-food" });
      continue;
    }
    if (food.negligible) continue;
    if (ingredient.amount === null) {
      unquantified.push(ingredient.displayName);
      continue;
    }

    const grams = ingredientGrams(ingredient, food);
    if (grams === null) {
      unresolved.push({ displayName: ingredient.displayName, reason: "no-unit-conversion" });
      continue;
    }
    if (!food.nutrition) {
      unresolved.push({ displayName: ingredient.displayName, reason: "no-nutrition" });
      continue;
    }

    const factor = grams / 100;
    for (const key of Object.keys(total) as (keyof NutritionPerServing)[]) {
      total[key] += food.nutrition[key] * factor;
    }
  }

  const divisor = Math.max(servings, 1);
  const perServing = { ...ZERO };
  for (const key of Object.keys(total) as (keyof NutritionPerServing)[]) {
    perServing[key] = total[key] / divisor;
  }

  return { perServing, complete: unresolved.length === 0, unresolved, unquantified };
}

/** Anzeige-/Speicherrundung: kcal und Natrium ganzzahlig, Makros auf eine Nachkommastelle. */
export function roundNutrition(n: NutritionPerServing): NutritionPerServing {
  const one = (v: number) => Math.round(v * 10) / 10;
  return {
    kcal: Math.round(n.kcal),
    proteinG: one(n.proteinG),
    carbsG: one(n.carbsG),
    fatG: one(n.fatG),
    fiberG: one(n.fiberG),
    sugarG: one(n.sugarG),
    saturatedFatG: one(n.saturatedFatG),
    sodiumMg: Math.round(n.sodiumMg),
  };
}
