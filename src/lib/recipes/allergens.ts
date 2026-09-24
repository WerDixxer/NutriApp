import type { TagSuggestion } from "../tagInput";
import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import { DEFAULT_SUGGESTION_LIMIT, MIN_SUGGESTION_LENGTH, prefixRank, type SuggestOptions } from "./foodSuggestions";

/**
 * Kanonisches Allergen-Vokabular: genau die Begriffe, die Foods
 * (`Ingredient.allergens`) und Rezepte (`Recipe.allergens`) tatsächlich tragen
 * (per Datenbank geprüft). Nutzer-Allergien sind Freitext ("Erdnüsse",
 * "Laktose", "Nuss-Allergie") und werden hier auf dieses Vokabular abgebildet,
 * statt per Teilstring gegen den Rohtext verglichen zu werden: "erdnüsse" enthält
 * "erdnuss" NICHT, deshalb hat der frühere Vergleich Erdnuss-Rezepte durchgelassen.
 */
export const CANONICAL_ALLERGENS = ["erdnuss", "nüsse", "milch", "soja", "gluten", "ei", "fisch", "sesam", "schalentiere"] as const;
export type CanonicalAllergen = (typeof CANONICAL_ALLERGENS)[number];

interface AllergenTerms {
  /**
   * Anzeigename für Eingabevorschläge. Jeder Name steht selbst in `terms`, löst
   * also über `resolveAllergyLabels` genau auf diesen Eintrag auf.
   */
  label: string;
  /** Was der Begriff auf der REZEPT-Seite bedeutet (genau ein kanonisches Allergen). */
  recipe: CanonicalAllergen;
  /** Was der Begriff als NUTZER-Allergie sperrt. Standard: dasselbe Allergen. */
  user?: CanonicalAllergen[];
  terms: string[];
}

/**
 * Nur eindeutige Synonyme und Schreibvarianten. Bewusst vorsichtig (im Zweifel
 * mehr sperren, nie weniger): der Oberbegriff "Nüsse" sperrt auch Erdnuss,
 * "Weizen" sperrt Gluten. Konkrete Baumnüsse sperren nur "nüsse".
 */
const ALLERGEN_TERMS: AllergenTerms[] = [
  { label: "Erdnuss", recipe: "erdnuss", terms: ["erdnuss", "erdnüsse", "erdnuß", "peanut", "peanuts"] },
  { label: "Nüsse", recipe: "nüsse", user: ["nüsse", "erdnuss"], terms: ["nuss", "nüsse", "nuß", "nuts", "nut", "schalenfrüchte"] },
  {
    label: "Baumnüsse",
    recipe: "nüsse",
    terms: ["baumnuss", "baumnüsse", "walnuss", "walnüsse", "haselnuss", "haselnüsse", "mandel", "mandeln", "cashew", "cashews", "pistazie", "pistazien"],
  },
  {
    label: "Milch",
    recipe: "milch",
    terms: ["milch", "milchprodukte", "milchprodukt", "kuhmilch", "laktose", "lactose", "laktoseintoleranz", "milcheiweiß", "kasein", "casein", "molke"],
  },
  { label: "Soja", recipe: "soja", terms: ["soja", "soya", "sojabohne", "sojabohnen", "sojaprodukte"] },
  { label: "Gluten", recipe: "gluten", terms: ["gluten", "weizen", "zöliakie", "glutenunverträglichkeit"] },
  { label: "Eier", recipe: "ei", terms: ["ei", "eier", "hühnerei", "hühnereier"] },
  { label: "Fisch", recipe: "fisch", terms: ["fisch", "fische"] },
  { label: "Sesam", recipe: "sesam", terms: ["sesam", "sesamsamen"] },
  { label: "Schalentiere", recipe: "schalentiere", terms: ["schalentiere", "krebstiere", "meeresfrüchte", "garnelen", "shrimps"] },
];

const TERM_INDEX = new Map<string, AllergenTerms>();
for (const entry of ALLERGEN_TERMS) {
  for (const term of entry.terms) TERM_INDEX.set(normalizeFoodLabel(term), entry);
}

/** Füllwörter in Angaben wie "Allergie gegen Erdnüsse"; sie sind weder Allergen noch unbekannter Begriff. */
const FILLER = new Set(["allergie", "allergien", "allergiker", "gegen", "auf", "und", "oder", "kein", "keine", "unvertraeglichkeit", "intoleranz", "empfindlichkeit"]);
const COMPOUND_SUFFIXES = ["allergie", "unvertraeglichkeit", "intoleranz", "allergiker"];

function tokens(label: string): string[] {
  return normalizeFoodLabel(label)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => {
      for (const suffix of COMPOUND_SUFFIXES) {
        if (token.length > suffix.length + 2 && token.endsWith(suffix)) return token.slice(0, -suffix.length);
      }
      return token;
    })
    .filter((token) => !FILLER.has(token));
}

export interface ResolvedAllergies {
  /** Kanonische Allergene, die die Nutzerangaben sperren. */
  allergens: Set<CanonicalAllergen>;
  /** Begriffe, die keinem kanonischen Allergen zuzuordnen waren. Sie gelten NIE als sicher und werden als Text geprüft. */
  unresolvedTerms: string[];
}

/** "Erdnüsse" -> { erdnuss }, "Milch und Eier" -> { milch, ei }, "Sellerie" -> unresolved. */
export function resolveAllergyLabels(labels: string[]): ResolvedAllergies {
  const allergens = new Set<CanonicalAllergen>();
  const unresolvedTerms: string[] = [];
  for (const label of labels) {
    for (const token of tokens(label)) {
      const entry = TERM_INDEX.get(token);
      if (entry) for (const allergen of entry.user ?? [entry.recipe]) allergens.add(allergen);
      else if (token.length >= 3) unresolvedTerms.push(token);
    }
  }
  return { allergens, unresolvedTerms };
}

/**
 * Eingabevorschläge für Allergien aus demselben Vokabular, gegen das später
 * geprüft wird ("Erdn" -> Erdnuss, "Lakt" -> Milch mit Hinweis "laktose"). Sie
 * ersetzen die Auflösung nicht: gespeichert wird ein Name, den
 * `resolveAllergyLabels` wieder auf genau diesen Eintrag abbildet. Begriffe
 * außerhalb des Vokabulars (Sellerie, Senf) bekommen keinen Vorschlag und
 * bleiben Freitext, der wie bisher als Text geprüft wird.
 */
export function suggestAllergens(query: string, options: SuggestOptions = {}): TagSuggestion[] {
  const q = normalizeFoodLabel(query);
  if (q.length < MIN_SUGGESTION_LENGTH) return [];
  const excluded = new Set((options.exclude ?? []).map(normalizeFoodLabel));

  const hits: { suggestion: TagSuggestion; rank: number }[] = [];
  for (const entry of ALLERGEN_TERMS) {
    if (excluded.has(normalizeFoodLabel(entry.label))) continue;
    let best: { rank: number; term?: string } | null = null;
    const labelRank = prefixRank(entry.label, q, false);
    if (labelRank !== null) best = { rank: labelRank };
    for (const term of entry.terms) {
      const rank = prefixRank(term, q, true);
      if (rank !== null && (best === null || rank < best.rank)) best = { rank, term };
    }
    // Ist der Treffer nur der eigene Name in anderer Schreibweise, braucht er keinen Hinweis.
    const hint = best?.term && normalizeFoodLabel(best.term) !== normalizeFoodLabel(entry.label) ? best.term : undefined;
    if (best) hits.push({ rank: best.rank, suggestion: { label: entry.label, ...(hint ? { hint } : {}) } });
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.suggestion.label.localeCompare(b.suggestion.label, "de"))
    .slice(0, options.limit ?? DEFAULT_SUGGESTION_LIMIT)
    .map((h) => h.suggestion);
}

/** Rezept-/Food-Allergene auf kanonische Begriffe; unbekannte Angaben bleiben als normalisierter Text erhalten. */
export function canonicalizeRecipeAllergens(recipeAllergens: string[]): { canonical: Set<CanonicalAllergen>; other: string[] } {
  const canonical = new Set<CanonicalAllergen>();
  const other: string[] = [];
  for (const raw of recipeAllergens) {
    let known = false;
    for (const token of tokens(raw)) {
      const entry = TERM_INDEX.get(token);
      if (entry) {
        canonical.add(entry.recipe);
        known = true;
      }
    }
    if (!known) other.push(normalizeFoodLabel(raw));
  }
  return { canonical, other };
}

/**
 * Begriffe ab dieser Länge zählen auch als Anfang oder Ende eines zusammengesetzten Worts
 * ("Erdnussbutter", "Weizenmehl", "Buttermilch"). Kürzere ("ei", "nut") nur als ganzes Wort,
 * sonst träfe "ei" z.B. "Eisbergsalat".
 */
const COMPOUND_MIN_TERM_LENGTH = 4;

/** Zusammengesetzte Wörter, deren Allergen-Teil dieses Allergen gerade nicht bedeutet. */
const NOT_THIS_ALLERGEN: Record<string, CanonicalAllergen[]> = {
  kokosmilch: ["milch"],
  kokosnussmilch: ["milch"],
  hafermilch: ["milch"],
  reismilch: ["milch"],
  dinkelmilch: ["milch"],
  mandelmilch: ["milch"],
  cashewmilch: ["milch"],
  haselnussmilch: ["milch"],
  sojamilch: ["milch"],
  erbsenmilch: ["milch"],
  muskatnuss: ["nüsse"],
  kokosnuss: ["nüsse"],
  eiersatz: ["ei"],
};

/** Allergene, die ein einzelnes (normalisiertes) Wort eines Zutatentexts nennt. */
function allergensNamedByWord(word: string): CanonicalAllergen[] {
  const exact = TERM_INDEX.get(word);
  if (exact) return [exact.recipe];

  const found = new Set<CanonicalAllergen>();
  for (const [term, entry] of TERM_INDEX) {
    if (term.length < COMPOUND_MIN_TERM_LENGTH) continue;
    // "glutenfrei", "laktosefreie": das Wort sagt das Gegenteil des Allergens aus.
    const namesPrefix = word.startsWith(term) && !word.slice(term.length).startsWith("frei");
    if (namesPrefix || word.endsWith(term)) found.add(entry.recipe);
  }
  const notMeant = NOT_THIS_ALLERGEN[word] ?? [];
  return [...found].filter((allergen) => !notMeant.includes(allergen));
}

/**
 * Sucht zusammenhängende Wortfolgen (längste zuerst), die im FoodCatalog ein Food benennen, und
 * übernimmt dessen gepflegte Allergene. Mehrdeutige Aliase zählen mit den Allergenen ALLER
 * möglichen Foods (im Zweifel mehr sperren). Liefert die so abgedeckten Wortpositionen.
 */
function addAllergensOfNamedFoods(words: string[], catalog: FoodCatalog, found: Set<CanonicalAllergen>): Set<number> {
  const covered = new Set<number>();
  for (let length = words.length; length >= 1; length--) {
    for (let start = 0; start + length <= words.length; start++) {
      const positions = Array.from({ length }, (_, i) => start + i);
      if (positions.some((p) => covered.has(p))) continue;
      const foods = catalog.resolveLabel(words.slice(start, start + length).join(" "));
      if (foods.length === 0) continue;
      for (const food of foods) for (const allergen of canonicalizeRecipeAllergens(food.allergens).canonical) found.add(allergen);
      for (const p of positions) covered.add(p);
    }
  }
  return covered;
}

/**
 * Allergene, die aus Zutatenzeilen eindeutig hervorgehen. Zeilenteile, die im FoodCatalog auf ein
 * Food auflösen ("Skyr", "Räuchertofu", "Hafermilch"), zählen mit dessen gepflegten Allergenen und
 * werden nicht zusätzlich als Text gedeutet ("Hafermilch" ist Haferdrink: Gluten, keine Milch).
 * Alle übrigen Wörter laufen gegen das Allergen-Vokabular oben. Ohne Katalog bleibt nur der Text.
 */
export function allergensInIngredientLines(lines: readonly string[], catalog?: FoodCatalog): Set<CanonicalAllergen> {
  const found = new Set<CanonicalAllergen>();
  for (const line of lines) {
    const words = normalizeFoodLabel(line)
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const coveredByFoods = catalog ? addAllergensOfNamedFoods(words, catalog, found) : new Set<number>();
    words.forEach((word, i) => {
      if (!coveredByFoods.has(i)) for (const allergen of allergensNamedByWord(word)) found.add(allergen);
    });
  }
  return found;
}

/**
 * Sperrt ein Rezept wegen der Allergien eines Nutzers? Drei Wege:
 *  1. aufgelöste Allergene gegen die kanonischen Rezept-Allergene,
 *  2. aufgelöste Allergene gegen die Zutatenzeilen (`allergensInIngredientLines`): gespeicherte
 *     Rezept-Allergene können unvollständig sein - eigene und Altrezepte werden von Hand gepflegt,
 *     ein fehlender Eintrag darf ein Rezept nicht "sicher" machen,
 *  3. unaufgelöste Begriffe (nicht im Vokabular) als Text gegen unbekannte
 *     Rezept-Allergene und, wenn übergeben, gegen die Zutatenzeilen.
 * Ein nicht eindeutig zuordenbarer Begriff gilt damit nie als "sicher". `catalog` (wo vorhanden)
 * erkennt in Weg 2 auch Foods, deren Name kein Allergen nennt ("Skyr" -> Milch).
 */
export function recipeBlockedByAllergies(
  recipeAllergens: string[],
  allergyLabels: string[],
  ingredientLines: string[] = [],
  catalog?: FoodCatalog,
): boolean {
  if (allergyLabels.length === 0) return false;
  const { allergens, unresolvedTerms } = resolveAllergyLabels(allergyLabels);
  const { canonical, other } = canonicalizeRecipeAllergens(recipeAllergens);

  for (const allergen of allergens) if (canonical.has(allergen)) return true;

  if (allergens.size > 0 && ingredientLines.length > 0) {
    const inIngredients = allergensInIngredientLines(ingredientLines, catalog);
    for (const allergen of allergens) if (inIngredients.has(allergen)) return true;
  }

  if (unresolvedTerms.length === 0) return false;
  const lines = ingredientLines.map(normalizeFoodLabel);
  return unresolvedTerms.some(
    (term) => other.some((o) => o.includes(term) || term.includes(o)) || lines.some((line) => line.includes(term)),
  );
}
