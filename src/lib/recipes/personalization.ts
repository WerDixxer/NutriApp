import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import { deriveAllergens, deriveDietClass } from "./diet";
import { computeRecipeNutrition, type NutritionResult } from "./nutrition";
import type { AlternativeType, DietClass, StructuredIngredient } from "./types";
import { formatIngredientLine } from "./units";

/**
 * Präferenzen liegen in der App als Freitext-Labels vor (ProfileTag: "Magerquark",
 * "Hähnchen"). Dieses Format bleibt unverändert; hier werden die Labels erst
 * beim Matching auf zentrale Foods aufgelöst.
 */
export interface PreferenceLabels {
  favoriteFoods: string[];
  dislikedFoods: string[];
}

export interface ResolvedLabel {
  label: string;
  /** Leer = das Label ist (noch) keinem kuratierten Food zuordenbar -> Textabgleich wie bisher. */
  foodIds: string[];
}

export interface ResolvedPreferences {
  favorites: ResolvedLabel[];
  dislikes: ResolvedLabel[];
}

export function resolvePreferences(labels: PreferenceLabels, catalog: FoodCatalog): ResolvedPreferences {
  const resolve = (label: string): ResolvedLabel => ({
    label,
    foodIds: catalog.resolveLabel(label).map((f) => f.id),
  });
  return {
    favorites: labels.favoriteFoods.filter((l) => l.trim()).map(resolve),
    dislikes: labels.dislikedFoods.filter((l) => l.trim()).map(resolve),
  };
}

/** Rezept aus Sicht des Matchings: strukturierte Zutaten, bei Altrezepten nur die Freitext-Zeilen. */
export interface MatchableRecipe {
  ingredients: StructuredIngredient[];
  /** Recipe.ingredients (Freitext); Rückfall für Rezepte ohne strukturierte Zeilen. */
  ingredientLines: string[];
}

export type FavoriteMatch =
  | { kind: "direct"; label: string; foodId: string; ingredientIndex: number }
  | {
      kind: "alternative";
      label: string;
      favoriteFoodId: string;
      originalFoodId: string;
      ingredientIndex: number;
      alternativeType: AlternativeType;
      /** true = die Kante darf automatisch eingesetzt werden (personalizeRecipe). */
      autoSwap: boolean;
    }
  | { kind: "text"; label: string; ingredientIndex: number | null };

export interface DislikeConflict {
  label: string;
  foodId: string | null;
  ingredientIndex: number | null;
  optional: boolean;
  /** Definierte Alternativen für die ungeliebte Zutat (Grundlage für eine spätere automatische Ersetzung). */
  replacements: { foodId: string; type: AlternativeType; requiresContext: boolean }[];
}

export interface RecipePreferenceMatch {
  /** Mindestens ein Lieblingsfood steckt direkt oder als Alternative im Rezept. */
  relevant: boolean;
  /** Bester Treffer je Lieblings-Label. */
  favoriteMatches: FavoriteMatch[];
  dislikeConflicts: DislikeConflict[];
  hasDislikedConflict: boolean;
  /** Einfache Summe (direkt 1, sichere Alternative 0,6, kontextabhängige 0,3, Text 1): Grundlage, kein Ranking-System. */
  favoriteScore: number;
}

const MATCH_WEIGHT = { direct: 1, text: 1, autoAlternative: 0.6, contextAlternative: 0.3 } as const;

function textIndex(recipe: MatchableRecipe, label: string): number | null | undefined {
  const needle = normalizeFoodLabel(label);
  if (!needle) return undefined;
  if (recipe.ingredients.length > 0) {
    const index = recipe.ingredients.findIndex((i) => normalizeFoodLabel(i.displayName).includes(needle));
    return index === -1 ? undefined : index;
  }
  const found = recipe.ingredientLines.some((line) => normalizeFoodLabel(line).includes(needle));
  return found ? null : undefined;
}

function bestFavoriteMatch(
  favorite: ResolvedLabel,
  recipe: MatchableRecipe,
  catalog: FoodCatalog,
): FavoriteMatch | null {
  if (favorite.foodIds.length === 0 || recipe.ingredients.length === 0) {
    const index = textIndex(recipe, favorite.label);
    return index === undefined ? null : { kind: "text", label: favorite.label, ingredientIndex: index };
  }

  const ids = new Set(favorite.foodIds);
  const direct = recipe.ingredients.findIndex((i) => ids.has(i.foodId));
  if (direct !== -1) {
    return { kind: "direct", label: favorite.label, foodId: recipe.ingredients[direct].foodId, ingredientIndex: direct };
  }

  let best: Extract<FavoriteMatch, { kind: "alternative" }> | null = null;
  for (let ingredientIndex = 0; ingredientIndex < recipe.ingredients.length; ingredientIndex++) {
    const ingredient = recipe.ingredients[ingredientIndex];
    for (const favoriteFoodId of favorite.foodIds) {
      const edge = catalog.edge(ingredient.foodId, favoriteFoodId);
      if (!edge) continue;
      const candidate: Extract<FavoriteMatch, { kind: "alternative" }> = {
        kind: "alternative",
        label: favorite.label,
        favoriteFoodId,
        originalFoodId: ingredient.foodId,
        ingredientIndex,
        alternativeType: edge.type,
        autoSwap: !edge.requiresContext,
      };
      if (!best || (candidate.autoSwap && !best.autoSwap)) best = candidate;
    }
  }
  if (best) return best;

  const index = textIndex(recipe, favorite.label);
  return index === undefined ? null : { kind: "text", label: favorite.label, ingredientIndex: index };
}

function dislikeConflict(
  disliked: ResolvedLabel,
  recipe: MatchableRecipe,
  catalog: FoodCatalog,
  dislikedFoodIds: Set<string>,
): DislikeConflict | null {
  if (disliked.foodIds.length > 0 && recipe.ingredients.length > 0) {
    const ids = new Set(disliked.foodIds);
    const index = recipe.ingredients.findIndex((i) => ids.has(i.foodId));
    if (index !== -1) {
      const ingredient = recipe.ingredients[index];
      return {
        label: disliked.label,
        foodId: ingredient.foodId,
        ingredientIndex: index,
        optional: ingredient.optional,
        replacements: catalog
          .alternativesFor(ingredient.foodId)
          .filter((e) => !dislikedFoodIds.has(e.toId))
          .map((e) => ({ foodId: e.toId, type: e.type, requiresContext: e.requiresContext })),
      };
    }
    // Aufgelöstes Label ohne Treffer in den strukturierten Zutaten: kein Konflikt.
    return null;
  }

  const index = textIndex(recipe, disliked.label);
  if (index === undefined) return null;
  return { label: disliked.label, foodId: null, ingredientIndex: index, optional: false, replacements: [] };
}

/**
 * Erkennt für EIN Rezept, ob es zu den Präferenzen passt:
 *  1. Lieblingsfood steckt direkt im Rezept (auch über Alias: "Hähnchen" = Hähnchenbrust),
 *  2. Lieblingsfood ist eine gepflegte Alternative einer Rezeptzutat (Magerquark statt Skyr),
 *  3. ungeliebtes Food steckt im Rezept -> `dislikeConflicts` (wird NIE ignoriert).
 * Das Ergebnis ist eine Datenstruktur für spätere Empfehlungen, kein Ranking.
 */
export function matchRecipeToPreferences(
  recipe: MatchableRecipe,
  preferences: ResolvedPreferences,
  catalog: FoodCatalog,
): RecipePreferenceMatch {
  const favoriteMatches = preferences.favorites
    .map((favorite) => bestFavoriteMatch(favorite, recipe, catalog))
    .filter((m): m is FavoriteMatch => m !== null);

  const dislikedFoodIds = new Set(preferences.dislikes.flatMap((d) => d.foodIds));
  const dislikeConflicts = preferences.dislikes
    .map((disliked) => dislikeConflict(disliked, recipe, catalog, dislikedFoodIds))
    .filter((c): c is DislikeConflict => c !== null);

  const favoriteScore = favoriteMatches.reduce((sum, m) => {
    if (m.kind === "direct") return sum + MATCH_WEIGHT.direct;
    if (m.kind === "text") return sum + MATCH_WEIGHT.text;
    return sum + (m.autoSwap ? MATCH_WEIGHT.autoAlternative : MATCH_WEIGHT.contextAlternative);
  }, 0);

  return {
    relevant: favoriteMatches.length > 0,
    favoriteMatches,
    dislikeConflicts,
    hasDislikedConflict: dislikeConflicts.length > 0,
    favoriteScore,
  };
}

export interface IngredientSwap {
  ingredientIndex: number;
  fromFoodId: string;
  fromName: string;
  toFoodId: string;
  toName: string;
  type: AlternativeType;
  favoriteLabel: string;
}

export interface PersonalizedRecipe {
  /** true, sobald mindestens eine Zutat durch ein Lieblingsfood ersetzt wurde ("Für dich angepasst"). */
  adapted: boolean;
  swaps: IngredientSwap[];
  ingredients: StructuredIngredient[];
  ingredientLines: string[];
  /** Neu aus den tatsächlich verwendeten Foods berechnet, NICHT die festen Rezeptwerte. */
  nutrition: NutritionResult;
  originalNutrition: NutritionResult;
  allergens: string[];
  dietClass: DietClass;
}

/**
 * Baut die personalisierte Variante: jede Zutat, für die eine sichere
 * (`requiresContext = false`) Alternative existiert, die der Nutzer als
 * Lieblingsfood angegeben hat, wird ersetzt - gleiche Menge, anderes Food.
 * Kontextabhängige Kanten (Avocado -> Hummus, Hähnchen -> Tofu) werden nie
 * automatisch eingesetzt, ebenso keine Alternative, die der Nutzer nicht
 * mag, und keine Zutat, die selbst schon ein Lieblingsfood ist. Nährwerte,
 * Allergene und Ernährungsform werden aus den gewählten Foods neu berechnet.
 */
export function personalizeRecipe(
  recipe: { servings: number; ingredients: StructuredIngredient[] },
  preferences: ResolvedPreferences,
  catalog: FoodCatalog,
): PersonalizedRecipe {
  const dislikedFoodIds = new Set(preferences.dislikes.flatMap((d) => d.foodIds));
  const favoriteFoodIds = new Set(preferences.favorites.flatMap((f) => f.foodIds));
  const swaps: IngredientSwap[] = [];

  const ingredients = recipe.ingredients.map((ingredient, ingredientIndex) => {
    if (favoriteFoodIds.has(ingredient.foodId)) return ingredient;

    for (const favorite of preferences.favorites) {
      for (const targetId of favorite.foodIds) {
        if (targetId === ingredient.foodId || dislikedFoodIds.has(targetId)) continue;
        const edge = catalog.edge(ingredient.foodId, targetId);
        const target = catalog.get(targetId);
        const source = catalog.get(ingredient.foodId);
        if (!edge || edge.requiresContext || !target || !source) continue;

        swaps.push({
          ingredientIndex,
          fromFoodId: source.id,
          fromName: source.name,
          toFoodId: target.id,
          toName: target.name,
          type: edge.type,
          favoriteLabel: favorite.label,
        });
        return { ...ingredient, foodId: target.id, displayName: target.name };
      }
    }
    return ingredient;
  });

  return {
    adapted: swaps.length > 0,
    swaps,
    ingredients,
    ingredientLines: ingredients.map(formatIngredientLine),
    nutrition: computeRecipeNutrition(ingredients, recipe.servings, catalog),
    originalNutrition: computeRecipeNutrition(recipe.ingredients, recipe.servings, catalog),
    allergens: deriveAllergens(ingredients, catalog),
    dietClass: deriveDietClass(ingredients, catalog),
  };
}
