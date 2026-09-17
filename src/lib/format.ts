/** Rundet auf ganze Gramm und markiert als Circa-Angabe, z.B. "~63 g". */
export function approxGrams(value: number): string {
  return `~${Math.round(value)} g`;
}

/** Rundet auf ganze kcal und markiert als Circa-Angabe, z.B. "~450 kcal". */
export function approxKcal(value: number): string {
  return `~${Math.round(value)} kcal`;
}
