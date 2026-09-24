import type { FoodCatalog } from "./catalog";
import {
  matchRecipeToPreferences,
  resolvePreferences,
  type PreferenceLabels,
  type RecipePreferenceMatch,
  type ResolvedPreferences,
} from "./personalization";
import type { StructuredIngredient } from "./types";

/**
 * Die EINE Stelle, an der Planer, Suche, Entscheidungsassistent und Dashboard
 * Präferenz-Labels ("Hähnchen", "Reis", "Paprika") gegen Rezepte prüfen. Sie
 * ist eine dünne Hülle um matchRecipeToPreferences() (Food-Katalog, Aliase,
 * Alternativen) und keine zweite Matching-Logik:
 *
 * - strukturiertes Rezept + bekanntes Food  -> Food-ID-Abgleich
 * - Altrezept ohne strukturierte Zutaten     -> Textabgleich über die Freitext-Zutaten
 * - unbekanntes Label                        -> Textabgleich (nie ein Treffer aus dem Nichts)
 */

/** Alles, was ein Rezept für den Abgleich braucht; SearchableRecipe und RecipeCandidate erfüllen das. */
export interface PreferenceSubject {
  id: string;
  ingredients: string[];
  structured?: StructuredIngredient[];
}

export interface FoodPreferenceContext {
  catalog: FoodCatalog;
  preferences: ResolvedPreferences;
  /** Ergebnis je Rezept, pro Kontext nur einmal berechnet. */
  matchFor(subject: PreferenceSubject): RecipePreferenceMatch;
}

export function createFoodPreferenceContext(labels: PreferenceLabels, catalog: FoodCatalog): FoodPreferenceContext {
  const preferences = resolvePreferences(labels, catalog);
  const cache = new Map<string, RecipePreferenceMatch>();
  return {
    catalog,
    preferences,
    matchFor(subject) {
      const cached = cache.get(subject.id);
      if (cached) return cached;
      const match = matchRecipeToPreferences(
        { ingredients: subject.structured ?? [], ingredientLines: subject.ingredients },
        preferences,
        catalog,
      );
      cache.set(subject.id, match);
      return match;
    },
  };
}

/**
 * Ein Lieblingsfood steckt im Rezept (direkt oder über den Text). Eine bloße
 * Alternative ("Magerquark statt Skyr") zählt hier nicht: die Bewertung
 * bleibt so wie zuvor ("enthält ein Lieblingsfood"), die Alternative wird
 * erst in der personalisierten Variante sichtbar.
 */
export function isLikedHit(match: RecipePreferenceMatch): boolean {
  return match.favoriteMatches.some((m) => m.kind !== "alternative");
}

/** Ein ungeliebtes Food steckt im Rezept. Ob das hart ausschließt oder nur abwertet, entscheidet der jeweilige Aufrufer. */
export function isDislikedHit(match: RecipePreferenceMatch): boolean {
  return match.hasDislikedConflict;
}

/** Welche der übergebenen Begriffe steckt im Rezept? Dieselbe Auflösung wie bei den Abneigungen. */
export function conflictingLabels(subject: PreferenceSubject, labels: string[], catalog: FoodCatalog): string[] {
  if (labels.length === 0) return [];
  const preferences = resolvePreferences({ favoriteFoods: [], dislikedFoods: labels }, catalog);
  return matchRecipeToPreferences({ ingredients: subject.structured ?? [], ingredientLines: subject.ingredients }, preferences, catalog)
    .dislikeConflicts.map((c) => c.label);
}
