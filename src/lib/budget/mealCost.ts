import type { PantryUnit } from "@prisma/client";
import { convertQuantity } from "../pantry/units";

/**
 * Grundlage für Kosten-pro-Rezept (siehe Chapter-8-Analyse): Rezept.ingredients
 * ist aktuell unstrukturierter Freitext ("2 Gurken"), es existiert keine
 * strukturierte Rezept<->Ingredient-Verknüpfung. Eine Freitext-Mengen-Parsing-
 * Heuristik würde genau das Risiko erzeugen, das in diesem Projekt an
 * mehreren Stellen explizit ausgeschlossen ist: ein falsch geparster Wert,
 * der wie ein verifizierter Preis aussieht. Diese Datei liefert deshalb nur
 * die reine, getestete Aggregations-Grundlage (strukturierte Mengen -> Preis),
 * die Verdrahtung an echte Rezepte folgt erst, wenn eine strukturierte
 * Zutatenliste existiert (siehe Report, "Offene Punkte").
 */

export interface IngredientNeed {
  name: string;
  quantity: number;
  unit: PantryUnit;
}

export interface KnownPrice {
  priceCents: number;
  quantity: number;
  unit: PantryUnit;
}

export interface IngredientCostResult {
  name: string;
  /** null = kein Preis bekannt oder Einheit nicht kompatibel, NIE als 0 behandelt. */
  costCents: number | null;
}

export interface TotalCostResult {
  /** null, sobald auch nur eine Zutat nicht bewertbar ist (kein stillschweigend unvollständiger Preis). */
  totalCostCents: number | null;
  ingredientCosts: IngredientCostResult[];
}

/** Berechnet die Kosten einer benötigten Menge aus einem bekannten Preis für eine (ggf. andere) Menge/Einheit derselben Zutat. */
export function calculateIngredientCost(need: IngredientNeed, price: KnownPrice | null): IngredientCostResult {
  if (!price || price.quantity <= 0) return { name: need.name, costCents: null };

  const convertedQuantity = convertQuantity(need.quantity, need.unit, price.unit);
  if (convertedQuantity === null) return { name: need.name, costCents: null };

  const pricePerBaseUnit = price.priceCents / price.quantity;
  const costCents = Math.round(pricePerBaseUnit * convertedQuantity);
  return { name: need.name, costCents };
}

/** Normalisiert einen Zutatennamen für den Preis-Lookup (analog zu ingredientCatalog.ts). */
export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase();
}

export function calculateTotalCost(needs: IngredientNeed[], priceByNormalizedName: Map<string, KnownPrice>): TotalCostResult {
  const ingredientCosts = needs.map((need) =>
    calculateIngredientCost(need, priceByNormalizedName.get(normalizeIngredientName(need.name)) ?? null),
  );
  const allKnown = ingredientCosts.every((c) => c.costCents !== null);
  const totalCostCents = allKnown ? ingredientCosts.reduce((sum, c) => sum + (c.costCents ?? 0), 0) : null;
  return { totalCostCents, ingredientCosts };
}
