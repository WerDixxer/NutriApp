import type { PantryUnit } from "@prisma/client";
import { convertQuantity } from "../pantry/units";
import { calculateIngredientCost, type KnownPrice } from "../budget/mealCost";
import { resolvePantryFoodIds } from "../pantry/pantryFoods";
import type { FoodCatalog } from "../recipes/catalog";
import { normalizeIngredientKey } from "./ingredientParser";
import type { RotationUrgency } from "../rotation/types";
import type { AggregatedIngredient, PantryContribution } from "./types";

export interface PantryItemForMatch {
  id: string;
  name: string;
  /** Verknüpftes zentrales Food/Ingredient (`PantryItem.ingredientId`); fehlt bei freien Items. */
  ingredientId?: string | null;
  remainingQuantity: number;
  unit: PantryUnit;
}

const URGENCY_RANK: Record<RotationUrgency, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Gehört dieses Pantry Item zur aggregierten Rezeptzutat? Das EINE Prädikat für
 * Meal Prep, Einkaufsliste und Insights:
 *  - Zeigen Pantry Item UND Rezeptzutat auf kuratierte Foods (ID oder Katalog-Alias,
 *    siehe pantry/pantryFoods.ts), entscheidet allein die Food-ID: "Hühnchen" im
 *    Vorrat deckt "Hähnchenbrust" im Rezept, "Reis" deckt nie "Reiswaffeln".
 *  - Sonst (freie/unbekannte Zutat oder kein Katalog übergeben) der bisherige
 *    exakte Namensabgleich über normalizeIngredientKey().
 */
export function pantryItemMatchesIngredient(item: PantryItemForMatch, normalizedName: string, catalog?: FoodCatalog): boolean {
  if (catalog) {
    const pantryFoodIds = resolvePantryFoodIds(item, catalog);
    const ingredientFoods = pantryFoodIds.length > 0 ? catalog.resolveLabel(normalizedName) : [];
    if (ingredientFoods.length > 0) return ingredientFoods.some((food) => pantryFoodIds.includes(food.id));
  }
  return normalizeIngredientKey(item.name) === normalizedName;
}

/**
 * Matcht eine aggregierte Zutat gegen den tatsächlichen Pantry-Bestand
 * (Abschnitt 13), siehe pantryItemMatchesIngredient(). Kein Fuzzy-Match.
 * Inkompatible Einheiten werden übersprungen (kein Rateergebnis). Verändert
 * NIEMALS Pantry-Mengen, liest nur.
 */
export function matchPantryContribution(
  normalizedName: string,
  targetUnit: PantryUnit,
  pantryItems: PantryItemForMatch[],
  urgencyByItemId: Map<string, RotationUrgency>,
  catalog?: FoodCatalog,
): PantryContribution | null {
  let totalAvailable = 0;
  let matchedAny = false;
  let worstUrgency: RotationUrgency | null = null;

  for (const item of pantryItems) {
    if (!pantryItemMatchesIngredient(item, normalizedName, catalog)) continue;
    const converted = convertQuantity(item.remainingQuantity, item.unit, targetUnit);
    if (converted === null) continue;

    matchedAny = true;
    totalAvailable += converted;
    const urgency = urgencyByItemId.get(item.id);
    if (urgency && URGENCY_RANK[urgency] > URGENCY_RANK[worstUrgency ?? "UNKNOWN"]) worstUrgency = urgency;
  }

  if (!matchedAny) return null;
  return { availableQuantity: Math.round(totalAvailable * 100) / 100, urgency: worstUrgency };
}

/**
 * Bekannte Kosten für die benötigte Gesamtmenge, siehe budget/mealCost.ts
 * (Kapitel 8) - hier erstmals tatsächlich verdrahtet, weil die Meal-Prep-
 * Aggregation (anders als einzelne Rezept-Kandidaten in Kapitel 10) echte
 * strukturierte Mengen liefert. `null`, wenn kein FoodPrice-Eintrag für diese
 * Zutat existiert - NIE als 0€ interpretiert.
 */
export function matchCost(displayName: string, quantity: number, unit: PantryUnit, priceByKey: Map<string, KnownPrice>): number | null {
  const price = priceByKey.get(normalizeIngredientKey(displayName)) ?? null;
  return calculateIngredientCost({ name: displayName, quantity, unit }, price).costCents;
}

export function enrichAggregatedIngredients(
  aggregated: AggregatedIngredient[],
  pantryItems: PantryItemForMatch[],
  urgencyByItemId: Map<string, RotationUrgency>,
  priceByKey: Map<string, KnownPrice>,
  catalog?: FoodCatalog,
): AggregatedIngredient[] {
  return aggregated.map((ingredient) => ({
    ...ingredient,
    pantry: matchPantryContribution(ingredient.normalizedName, ingredient.unit, pantryItems, urgencyByItemId, catalog),
    costCents: matchCost(ingredient.displayName, ingredient.totalQuantity, ingredient.unit, priceByKey),
  }));
}
