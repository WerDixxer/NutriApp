import type { PantryUnit } from "@prisma/client";
import { convertQuantity } from "../pantry/units";
import { calculateIngredientCost, type KnownPrice } from "../budget/mealCost";
import { normalizeIngredientKey } from "./ingredientParser";
import type { RotationUrgency } from "../rotation/types";
import type { AggregatedIngredient, PantryContribution } from "./types";

export interface PantryItemForMatch {
  id: string;
  name: string;
  remainingQuantity: number;
  unit: PantryUnit;
}

const URGENCY_RANK: Record<RotationUrgency, number> = { UNKNOWN: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/**
 * Matcht eine aggregierte Zutat gegen den tatsächlichen Pantry-Bestand
 * (Abschnitt 13). Exakter Namens-Abgleich über denselben
 * normalizeIngredientKey() wie die Aggregation selbst - kein Fuzzy-Match.
 * Inkompatible Einheiten werden übersprungen (kein Rateergebnis). Verändert
 * NIEMALS Pantry-Mengen, liest nur.
 */
export function matchPantryContribution(
  normalizedName: string,
  targetUnit: PantryUnit,
  pantryItems: PantryItemForMatch[],
  urgencyByItemId: Map<string, RotationUrgency>,
): PantryContribution | null {
  let totalAvailable = 0;
  let matchedAny = false;
  let worstUrgency: RotationUrgency | null = null;

  for (const item of pantryItems) {
    if (normalizeIngredientKey(item.name) !== normalizedName) continue;
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
): AggregatedIngredient[] {
  return aggregated.map((ingredient) => ({
    ...ingredient,
    pantry: matchPantryContribution(ingredient.normalizedName, ingredient.unit, pantryItems, urgencyByItemId),
    costCents: matchCost(ingredient.displayName, ingredient.totalQuantity, ingredient.unit, priceByKey),
  }));
}
