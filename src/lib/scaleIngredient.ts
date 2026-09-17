/**
 * Skaliert die führende Mengenangabe eines Zutaten-Strings (z.B. "200 g Hüttenkäse"
 * oder "1/2 Zwiebel") proportional zur Portionsgröße. Text ohne erkennbare Zahl am
 * Anfang bleibt unverändert.
 */
export function scaleIngredientText(text: string, factor: number): string {
  if (Math.abs(factor - 1) < 0.05) return text;

  const fractionMatch = text.match(/^(\d+)\/(\d+)(\s*)/);
  const decimalMatch = text.match(/^(\d+(?:[.,]\d+)?)(\s*)/);

  let value: number | null = null;
  let matchLength = 0;

  if (fractionMatch) {
    value = Number(fractionMatch[1]) / Number(fractionMatch[2]);
    matchLength = fractionMatch[0].length;
  } else if (decimalMatch) {
    value = Number(decimalMatch[1].replace(",", "."));
    matchLength = decimalMatch[0].length;
  }

  if (value === null) return text;

  const scaled = Math.max(Math.round((value * factor) * 2) / 2, 0.5);
  const display = scaled % 1 === 0 ? String(scaled) : String(scaled).replace(".", ",");

  return `${display} ${text.slice(matchLength)}`;
}
