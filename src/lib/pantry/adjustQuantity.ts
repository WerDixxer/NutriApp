export type QuantityAdjustment =
  | { type: "add"; amount: number }
  | { type: "consume"; amount: number }
  | { type: "set"; amount: number };

export interface AdjustQuantityResult {
  remainingQuantity: number;
  isEmpty: boolean;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Zentrale, reine Mengen-Domain-Funktion, damit keine API-Route eigene
 * Mengenberechnungen erfindet. Rundet auf 2 Nachkommastellen (Floating-
 * Point-Rauschen wie 0.1+0.2 !== 0.3), und klemmt das Ergebnis nie unter 0:
 * "keine negativen Mengen". Ob ein leerer Bestand gelöscht oder als leer
 * markiert bleibt, entscheidet die aufrufende Schicht (siehe pantryService.ts),
 * diese Funktion liefert nur den korrekten Zahlenwert plus `isEmpty`-Flag.
 */
export function applyQuantityAdjustment(
  currentRemaining: number,
  adjustment: QuantityAdjustment,
): AdjustQuantityResult {
  let next: number;
  switch (adjustment.type) {
    case "add":
      next = currentRemaining + adjustment.amount;
      break;
    case "consume":
      next = currentRemaining - adjustment.amount;
      break;
    case "set":
      next = adjustment.amount;
      break;
  }

  next = Math.max(0, round2(next));
  return { remainingQuantity: next, isEmpty: next <= 0 };
}
