import { prisma } from "../db";
import { pantryItemToRotationInput } from "./pantryMapping";
import { groupRotationResultsForDisplay, prioritizePantryItems } from "./rotationEngine";
import type { RotationResult } from "./types";

export interface HouseholdRotation {
  results: RotationResult[];
  useFirst: RotationResult[];
  planMeal: RotationResult[];
}

/**
 * Lädt die Pantry Items eines Haushalts EINMAL und berechnet die Priorität
 * für alle im Speicher (keine Query pro Item, siehe Kapitel-Auftrag Abschnitt
 * 14). Grundlage für die Rotation-UI und die `/api/pantry/rotation`-Route.
 */
export async function getHouseholdRotation(householdId: string, now: Date = new Date()): Promise<HouseholdRotation> {
  const items = await prisma.pantryItem.findMany({ where: { householdId } });
  const results = prioritizePantryItems(items.map(pantryItemToRotationInput), now);
  return { results, ...groupRotationResultsForDisplay(results) };
}

export interface HouseholdPantryContext {
  /** Namen aller vorhandenen (remainingQuantity > 0) Pantry Items. */
  availableIngredientNames: string[];
  /** Teilmenge davon mit CRITICAL/HIGH Rotation-Dringlichkeit. */
  urgentIngredientNames: string[];
}

/**
 * Für die Decision Engine: EINE Query liefert sowohl "was ist vorhanden"
 * (bestehender Pantry-Faktor, Kapitel 6) als auch "was ist dringend"
 * (neuer Food-Waste-Faktor, Kapitel 7), statt zwei getrennte Abfragen zu
 * duplizieren. Ersetzt das frühere `getAvailablePantryIngredientNames()`.
 */
export async function getPantryContextForHousehold(householdId: string, now: Date = new Date()): Promise<HouseholdPantryContext> {
  const items = await prisma.pantryItem.findMany({ where: { householdId, remainingQuantity: { gt: 0 } } });
  const results = prioritizePantryItems(items.map(pantryItemToRotationInput), now);
  const urgentIds = new Set(
    results.filter((r) => r.urgency === "CRITICAL" || r.urgency === "HIGH").map((r) => r.pantryItemId),
  );

  return {
    availableIngredientNames: items.map((i) => i.name),
    urgentIngredientNames: items.filter((i) => urgentIds.has(i.id)).map((i) => i.name),
  };
}
