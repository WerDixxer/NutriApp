/**
 * Geldbeträge laufen im gesamten Budget-Modul als Int-Cent (nie als Float),
 * um Rundungsfehler zu vermeiden (siehe schema.prisma-Kommentar zu
 * FoodBudget). Diese Datei ist die einzige Stelle, an der zwischen der
 * Euro-Dezimalzahl aus UI/API und der internen Cent-Repräsentation
 * umgerechnet wird.
 */

/** Euro-Dezimalzahl (z.B. 19.87 aus einem Formular) -> Cent, rundungssicher. */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

/** Cent -> Euro-Dezimalzahl (z.B. für JSON-Antworten, falls gebraucht). */
export function centsToEuros(cents: number): number {
  return cents / 100;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  EUR: "€",
};

/** Formatiert Cent als lesbaren Betrag, z.B. 1987 -> "19,87 €". */
export function formatCents(cents: number, currency: string = "EUR"): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;
  const euros = cents / 100;
  const formatted = euros.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${symbol}`;
}
