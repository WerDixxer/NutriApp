import type { PantryUnit } from "@prisma/client";

export const PANTRY_UNIT_LABELS: Record<PantryUnit, string> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "l",
  PIECE: "Stück",
  PACK: "Packung",
  PORTION: "Portion",
};

type Dimension = "weight" | "volume" | "count";

const DIMENSION_BY_UNIT: Record<PantryUnit, Dimension> = {
  G: "weight",
  KG: "weight",
  ML: "volume",
  L: "volume",
  PIECE: "count",
  PACK: "count",
  PORTION: "count",
};

/** Umrechnungsfaktor in die jeweilige Basiseinheit (g bzw. ml). */
const TO_BASE_FACTOR: Partial<Record<PantryUnit, number>> = {
  G: 1,
  KG: 1000,
  ML: 1,
  L: 1000,
};

/**
 * Rechnet eine Menge deterministisch zwischen Einheiten derselben Dimension
 * um (g<->kg, ml<->l). Gibt `null` zurück, wenn keine echte Umrechnung
 * existiert (z.B. Stück -> Gramm), statt eine erfundene Umrechnung wie
 * "1 Tomate = 120g" zu verwenden. Solche Umrechnungen brauchen echte Daten
 * oder eine Nutzerangabe, kein Rateergebnis der Domain-Logik.
 */
export function convertQuantity(amount: number, from: PantryUnit, to: PantryUnit): number | null {
  if (from === to) return amount;

  const fromDimension = DIMENSION_BY_UNIT[from];
  const toDimension = DIMENSION_BY_UNIT[to];
  if (fromDimension !== toDimension || fromDimension === "count") return null;

  const fromFactor = TO_BASE_FACTOR[from];
  const toFactor = TO_BASE_FACTOR[to];
  if (fromFactor === undefined || toFactor === undefined) return null;

  const inBaseUnit = amount * fromFactor;
  return inBaseUnit / toFactor;
}

export function isConvertible(from: PantryUnit, to: PantryUnit): boolean {
  return convertQuantity(1, from, to) !== null;
}
