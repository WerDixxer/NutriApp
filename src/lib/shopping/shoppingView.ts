import type { PantryUnit } from "@prisma/client";
import type { UnresolvedIngredient, WeeklyShoppingItem } from "./weeklyShopping";

/**
 * Aufbereitung des Ergebnisses von /api/shopping/week für die Anzeige. Hier
 * wird NICHT gerechnet, was gekauft werden muss (das liefert
 * calculateWeeklyShopping, inklusive Vorratsabzug), sondern nur sortiert,
 * gruppiert, gerundet und beschriftet.
 */

/** Die Felder des API-Ergebnisses, die die Anzeige braucht (Datumsfelder werden nicht benutzt). */
export interface ShoppingPayload {
  plannedDays: number;
  items: Pick<
    WeeklyShoppingItem,
    "key" | "ingredientName" | "unit" | "requiredQuantity" | "availableQuantity" | "missingQuantity" | "recipeCount" | "hasIncomparablePantryStock"
  >[];
  unresolvedIngredients: UnresolvedIngredient[];
}

export type ShoppingViewStatus = "no-plan" | "empty" | "all-covered" | "list";

export interface ShoppingBuyRow {
  key: string;
  name: string;
  /** Was noch zu kaufen ist, aufgerundet: "300 g". */
  buy: string;
  /** "Benötigt 500 g, Vorrat 200 g", nur wenn der Vorrat einen Teil deckt. */
  pantryDetail: string | null;
  /** "für 3 Rezepte", nur wenn mehrere Rezepte die Zutat brauchen. */
  recipesLabel: string | null;
  unitNote: string | null;
}

export interface ShoppingCoveredRow {
  key: string;
  name: string;
  detail: string;
}

export interface ShoppingUnresolvedRow {
  key: string;
  raw: string;
  mealsLabel: string;
}

export interface ShoppingView {
  status: ShoppingViewStatus;
  toBuy: ShoppingBuyRow[];
  covered: ShoppingCoveredRow[];
  unresolved: ShoppingUnresolvedRow[];
  /** Hinweis, wenn nicht für alle sieben Tage ein Plan existiert. */
  partialWeekNote: string | null;
}

const UNIT_LABELS: Record<PantryUnit, { one: string; many: string }> = {
  G: { one: "g", many: "g" },
  KG: { one: "kg", many: "kg" },
  ML: { one: "ml", many: "ml" },
  L: { one: "l", many: "l" },
  PIECE: { one: "Stück", many: "Stück" },
  PACK: { one: "Packung", many: "Packungen" },
  PORTION: { one: "Portion", many: "Portionen" },
};

function formatNumber(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/**
 * "300 g", "1,97 kg", "3 Stück". `buy` rundet auf (gekauft wird nie weniger als
 * gebraucht), `info` rundet kaufmännisch. Gramm und Milliliter werden ab 1000
 * als kg bzw. l gezeigt; Stück, Packungen und Portionen bleiben getrennt und
 * werden nie in Gewicht umgerechnet.
 */
export function formatShoppingQuantity(quantity: number, unit: PantryUnit, mode: "buy" | "info" = "info"): string {
  const round = mode === "buy" ? Math.ceil : Math.round;

  let base: number | null = null;
  let small: PantryUnit = unit;
  let large: PantryUnit | null = null;
  if (unit === "G" || unit === "KG") {
    base = unit === "KG" ? quantity * 1000 : quantity;
    small = "G";
    large = "KG";
  } else if (unit === "ML" || unit === "L") {
    base = unit === "L" ? quantity * 1000 : quantity;
    small = "ML";
    large = "L";
  }

  if (base !== null && large) {
    const amount = round(base);
    if (amount >= 1000) return `${formatNumber(round(base / 10) / 100)} ${UNIT_LABELS[large].one}`;
    return `${formatNumber(amount)} ${UNIT_LABELS[small].one}`;
  }

  const amount = mode === "buy" ? Math.ceil(quantity) : Math.round(quantity * 10) / 10;
  const labels = UNIT_LABELS[unit];
  return `${formatNumber(amount)} ${amount === 1 ? labels.one : labels.many}`;
}

/** Ohne Klammerzusatz und Zubereitungshinweis: "Erdbeeren, geviertelt" -> "Erdbeeren". */
export function cleanIngredientName(name: string): string {
  const cleaned = name.replace(/\([^)]*\)/g, "").split(",")[0].trim();
  return cleaned || name.trim();
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "de");

export function buildShoppingView(payload: ShoppingPayload): ShoppingView {
  const items = payload.items ?? [];
  const unresolvedIngredients = payload.unresolvedIngredients ?? [];

  const detail = (item: ShoppingPayload["items"][number]) =>
    `Benötigt ${formatShoppingQuantity(item.requiredQuantity, item.unit)}, Vorrat ${formatShoppingQuantity(item.availableQuantity, item.unit)}`;

  const toBuy: ShoppingBuyRow[] = items
    .filter((item) => item.missingQuantity > 0)
    .map((item) => ({
      key: item.key,
      name: cleanIngredientName(item.ingredientName),
      buy: formatShoppingQuantity(item.missingQuantity, item.unit, "buy"),
      pantryDetail: item.availableQuantity > 0 ? detail(item) : null,
      recipesLabel: item.recipeCount >= 2 ? `für ${item.recipeCount} Rezepte` : null,
      unitNote: item.hasIncomparablePantryStock ? "Im Vorrat in anderer Einheit" : null,
    }))
    .sort(byName);

  const covered: ShoppingCoveredRow[] = items
    .filter((item) => item.missingQuantity <= 0)
    .map((item) => ({ key: item.key, name: cleanIngredientName(item.ingredientName), detail: detail(item) }))
    .sort(byName);

  const unresolved: ShoppingUnresolvedRow[] = unresolvedIngredients
    .map((line) => ({
      key: line.raw,
      raw: line.raw,
      mealsLabel: line.occurrences === 1 ? "in 1 Mahlzeit" : `in ${line.occurrences} Mahlzeiten`,
    }))
    .sort((a, b) => a.raw.localeCompare(b.raw, "de"));

  let status: ShoppingViewStatus = "list";
  if (items.length === 0 && unresolved.length === 0) status = payload.plannedDays === 0 ? "no-plan" : "empty";
  else if (toBuy.length === 0 && unresolved.length === 0) status = "all-covered";

  return {
    status,
    toBuy,
    covered,
    unresolved,
    partialWeekNote:
      payload.plannedDays > 0 && payload.plannedDays < 7 ? `Berechnet für ${payload.plannedDays} von 7 Tagen mit Plan.` : null,
  };
}
