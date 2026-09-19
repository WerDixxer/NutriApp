import type { PantryUnit } from "@prisma/client";
import { normalizeIngredientName } from "../pantry/ingredientCatalog";

/**
 * Löst die in der Nachbesserungsliste offene "Recipe <-> Ingredient
 * strukturierte Verknüpfung" (siehe Kapitel-8/10-Berichte), ohne das
 * Recipe-Modell umzubauen: eine reine, deterministische Parse-Funktion statt
 * eines neuen, potenziell dauerhaft falschen gespeicherten Felds. Eine
 * gespeicherte Fehlinterpretation sähe für immer wie verifizierte Struktur
 * aus; eine Funktion, die bei Unsicherheit `null` zurückgibt, ist ehrlich bei
 * JEDEM Aufruf. `Recipe.ingredients` (Freitext) bleibt die alleinige
 * Quelle, diese Funktion liest sie nur.
 *
 * Erkennt ausschließlich Zeilen der Form "<Zahl> <bekannte Einheit> <Name>"
 * (z.B. "200 g Hähnchenbrust", "1kg Reis", "250 ml Milch (oder Pflanzendrink)").
 * Alles andere (Stückzahlen ohne Einheit wie "2 Eier", Löffelmaße wie
 * "1 EL Honig", Bereiche wie "1-2 TL", Brüche wie "1/2 Gurke", Zeilen ohne
 * Menge wie "Salz, Pfeffer") liefert bewusst `null` statt zu raten.
 */
export interface ParsedIngredientLine {
  raw: string;
  quantity: number;
  unit: PantryUnit;
  /** Name inkl. Klammer-/Kommazusatz, unverändert aus der Zeile. Für die Aggregation siehe normalizeIngredientKey(). */
  name: string;
}

const UNIT_ALIASES: Record<string, PantryUnit> = {
  g: "G",
  gramm: "G",
  kg: "KG",
  kilogramm: "KG",
  ml: "ML",
  milliliter: "ML",
  l: "L",
  liter: "L",
  stück: "PIECE",
  stk: "PIECE",
  packung: "PACK",
  pack: "PACK",
  portion: "PORTION",
  portionen: "PORTION",
};

const LINE_PATTERN = /^(\d+(?:[.,]\d+)?)\s*([a-zA-ZäöüÄÖÜß]+)\s+(.+)$/;

export function parseIngredientLine(raw: string): ParsedIngredientLine | null {
  const trimmed = raw.trim();
  const match = trimmed.match(LINE_PATTERN);
  if (!match) return null;

  const [, quantityStr, unitToken, namePart] = match;
  const quantity = Number(quantityStr.replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const unit = UNIT_ALIASES[unitToken.toLowerCase()];
  if (!unit) return null;

  const name = namePart.trim();
  if (!name) return null;

  return { raw: trimmed, quantity, unit, name };
}

/**
 * Schlüssel für die Aggregation gleicher Zutaten über mehrere Rezepte hinweg
 * (Kapitel 11, Abschnitt 5). Bewusst NUR eine sehr schmale Normalisierung
 * (Kleinschreibung, abschließende Kommazusätze wie ", in Streifen" und
 * Klammerzusätze wie "(oder Pflanzendrink)" entfernt): in den vorhandenen
 * Rezeptdaten sind das konsistent Zubereitungs-/Alternativhinweise, keine
 * andere Zutat. KEIN Stemming, keine Synonym-Liste, kein Fuzzy-Matching -
 * genau das würde z.B. "Hähnchenbrust" und "Hähnchenbrühe" fälschlich
 * zusammenführen (Abschnitt 5, explizit ausgeschlossen).
 */
export function normalizeIngredientKey(name: string): string {
  const withoutParens = name.replace(/\([^)]*\)/g, "");
  const withoutTrailingNote = withoutParens.split(",")[0];
  return normalizeIngredientName(withoutTrailingNote);
}
