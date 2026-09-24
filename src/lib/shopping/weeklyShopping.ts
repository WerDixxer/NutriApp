import type { PantryUnit } from "@prisma/client";
import { convertQuantity } from "../pantry/units";
import { aggregateIngredients, type MealForAggregation } from "../mealPrep/aggregation";
import { enrichAggregatedIngredients, pantryItemMatchesIngredient, type PantryItemForMatch } from "../mealPrep/enrichment";
import type { FoodCatalog } from "../recipes/catalog";
import type { SourceMealRef } from "../mealPrep/types";
import type { RotationUrgency } from "../rotation/types";

/**
 * Eine Zutat des Einkaufs, getrennt nach dem, was die Rezepte brauchen
 * (`requiredQuantity`), was im Vorrat ist (`availableQuantity`) und was noch
 * zu besorgen ist (`missingQuantity`). Alle drei Mengen stehen in `unit`.
 */
export interface WeeklyShoppingItem {
  /** Eindeutig je Zutat UND Einheit (`${normalizedName}::${unit}`), siehe AggregatedIngredient.key. */
  key: string;
  ingredientName: string;
  unit: PantryUnit;
  requiredQuantity: number;
  availableQuantity: number;
  /** `max(0, requiredQuantity - availableQuantity)`, nie negativ. */
  missingQuantity: number;
  sourceMeals: SourceMealRef[];
  recipeCount: number;
  /** Dringlichkeit des passenden Vorrats (nur wenn welcher gematcht wurde). */
  urgency: RotationUrgency | null;
  /**
   * `true`, wenn der Vorrat diese Zutat unter gleichem Namen, aber in einer
   * nicht vergleichbaren Einheit führt (z.B. Vorrat "Ei" in Stück, Rezept in
   * g). Dieser Bestand ist NICHT in `availableQuantity` enthalten, `missingQuantity`
   * kann darum zu hoch sein.
   */
  hasIncomparablePantryStock: boolean;
}

/**
 * Zutatenzeile, die ingredientParser.ts nicht strukturiert erkennt (z.B.
 * "1 EL Honig", "2 Eier", "Salz, Pfeffer"). Es gibt dafür bewusst keine
 * Menge: sie fließt in keine Summe ein, darf aber nicht verschwinden.
 */
export interface UnresolvedIngredient {
  raw: string;
  recipeNames: string[];
  /** In wie vielen geplanten Mahlzeiten diese Zeile vorkommt. */
  occurrences: number;
}

export interface WeeklyShoppingCalculation {
  items: WeeklyShoppingItem[];
  unresolvedIngredients: UnresolvedIngredient[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * `max(0, required - available)`. Beide Mengen müssen bereits in derselben
 * Einheit vorliegen. Auf zwei Nachkommastellen gerundet wie die Mengen in
 * aggregation.ts/enrichment.ts, damit Fließkomma-Reste (0.1 + 0.2) nie als
 * "fehlt noch 0.00000000000000004" enden.
 */
export function computeMissingQuantity(required: number, available: number): number {
  return round2(Math.max(0, required - available));
}

function collectUnresolved(unparsed: { raw: string; recipeName: string }[]): UnresolvedIngredient[] {
  const byRaw = new Map<string, { raw: string; recipeNames: Set<string>; occurrences: number }>();
  for (const line of unparsed) {
    const key = line.raw.trim().toLowerCase();
    const existing = byRaw.get(key);
    if (existing) {
      existing.recipeNames.add(line.recipeName);
      existing.occurrences += 1;
    } else {
      byRaw.set(key, { raw: line.raw.trim(), recipeNames: new Set([line.recipeName]), occurrences: 1 });
    }
  }
  return Array.from(byRaw.values())
    .map((u) => ({ raw: u.raw, recipeNames: Array.from(u.recipeNames).sort(), occurrences: u.occurrences }))
    .sort((a, b) => a.raw.localeCompare(b.raw));
}

/**
 * Reine Berechnung, unabhängig davon, aus welchem Plan die Mahlzeiten stammen
 * (siehe MealForAggregation): erst über ALLE übergebenen Mahlzeiten
 * aggregieren, dann erst den Vorrat abziehen. Baut vollständig auf
 * aggregateIngredients()/enrichAggregatedIngredients() auf (Parser, Namens-
 * und Einheitenlogik unverändert) und ergänzt nur die Differenz.
 *
 * Konservativ: Zutaten ohne passenden oder mit nicht umrechenbarem Vorrat
 * gelten als vollständig fehlend (`availableQuantity` 0), nie als vorhanden.
 * Nicht erkannte Zeilen landen in `unresolvedIngredients`, nie als Menge 0.
 */
export function calculateWeeklyShopping(
  meals: MealForAggregation[],
  pantryItems: PantryItemForMatch[],
  urgencyByItemId: Map<string, RotationUrgency> = new Map(),
  catalog?: FoodCatalog,
): WeeklyShoppingCalculation {
  const { aggregated, unparsed } = aggregateIngredients(meals);
  const enriched = enrichAggregatedIngredients(aggregated, pantryItems, urgencyByItemId, new Map(), catalog);

  const items: WeeklyShoppingItem[] = enriched.map((ingredient) => {
    const availableQuantity = ingredient.pantry?.availableQuantity ?? 0;
    const hasIncomparablePantryStock = pantryItems.some(
      (item) =>
        item.remainingQuantity > 0 &&
        pantryItemMatchesIngredient(item, ingredient.normalizedName, catalog) &&
        convertQuantity(item.remainingQuantity, item.unit, ingredient.unit) === null,
    );

    return {
      key: ingredient.key,
      ingredientName: ingredient.displayName,
      unit: ingredient.unit,
      requiredQuantity: ingredient.totalQuantity,
      availableQuantity,
      missingQuantity: computeMissingQuantity(ingredient.totalQuantity, availableQuantity),
      sourceMeals: ingredient.sourceMeals,
      recipeCount: ingredient.recipeCount,
      urgency: ingredient.pantry?.urgency ?? null,
      hasIncomparablePantryStock,
    };
  });

  return { items, unresolvedIngredients: collectUnresolved(unparsed) };
}
