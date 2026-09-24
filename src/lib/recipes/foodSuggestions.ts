import type { TagSuggestion } from "../tagInput";
import { normalizeFoodLabel } from "./catalog";
import type { CatalogFood } from "./types";

/**
 * Autocomplete-Vorschläge für Lieblingsfoods und Abneigungen, erzeugt aus den
 * Foods und Aliasen des bestehenden FoodCatalog (`catalog.all()`), nicht aus
 * einer eigenen Liste. Der Vorschlag trägt den KANONISCHEN Namen des Foods:
 * `catalog.resolveLabel(label)` löst ihn immer wieder auf genau dieses Food auf.
 *
 * Bewusst streng: Ein Vorschlag entsteht nur, wenn der Anfang des Namens, eines
 * Alias oder eines späteren Namenswortes zur Eingabe passt. Keine
 * Teilstring-Treffer aus der Wortmitte und keine Ähnlichkeitssuche, damit nie
 * ein Food vorgeschlagen wird, das nur zufällig ähnlich klingt.
 */

/** Genau die Felder, die die Vorschläge brauchen; ein CatalogFood erfüllt das und lässt sich serialisieren. */
export type SuggestionFood = Pick<CatalogFood, "id" | "name" | "aliases">;

export interface FoodSuggestion extends TagSuggestion {
  foodId: string;
}

export interface SuggestOptions {
  limit?: number;
  /** Bereits gewählte Labels; ihre Foods werden nicht erneut vorgeschlagen. */
  exclude?: string[];
}

export const MIN_SUGGESTION_LENGTH = 2;
export const DEFAULT_SUGGESTION_LIMIT = 6;

/**
 * 0 = Name beginnt so, 1 = Alias beginnt so, 2 = ein späteres Wort des Namens beginnt so
 * ("Light" in "Frischkäse light"). Aliase zählen nur am Anfang: Alias-Beschreibungen wie
 * "saft einer limette" würden sonst bei "Ei" zufällige Treffer liefern.
 */
export function prefixRank(term: string, normalizedQuery: string, isAlias: boolean): number | null {
  const normalized = normalizeFoodLabel(term);
  if (normalized.startsWith(normalizedQuery)) return isAlias ? 1 : 0;
  if (!isAlias && normalized.split(/[\s\-/]+/).some((word) => word.startsWith(normalizedQuery))) return 2;
  return null;
}

export function suggestFoods(foods: SuggestionFood[], query: string, options: SuggestOptions = {}): FoodSuggestion[] {
  const q = normalizeFoodLabel(query);
  if (q.length < MIN_SUGGESTION_LENGTH) return [];
  const excluded = new Set((options.exclude ?? []).map(normalizeFoodLabel));

  const hits: { suggestion: FoodSuggestion; rank: number }[] = [];
  for (const food of foods) {
    if (excluded.has(normalizeFoodLabel(food.name))) continue;
    let best: { rank: number; alias?: string } | null = null;
    const nameRank = prefixRank(food.name, q, false);
    if (nameRank !== null) best = { rank: nameRank };
    for (const alias of food.aliases) {
      const rank = prefixRank(alias, q, true);
      if (rank !== null && (best === null || rank < best.rank)) best = { rank, alias };
    }
    if (best) {
      hits.push({
        rank: best.rank,
        suggestion: { label: food.name, foodId: food.id, ...(best.alias ? { hint: best.alias } : {}) },
      });
    }
  }

  return hits
    .sort((a, b) => a.rank - b.rank || a.suggestion.label.length - b.suggestion.label.length || a.suggestion.label.localeCompare(b.suggestion.label, "de"))
    .slice(0, options.limit ?? DEFAULT_SUGGESTION_LIMIT)
    .map((h) => h.suggestion);
}
