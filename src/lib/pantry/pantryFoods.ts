import type { FoodCatalog } from "../recipes/catalog";
import { normalizeFoodLabel } from "../recipes/catalog";
import type { CatalogFood, StructuredIngredient } from "../recipes/types";
import { ingredientListIncludes } from "../foodMatching";

/**
 * Verbindet Pantry und Rezepte über das zentrale Food, statt Namen per
 * Teilstring zu vergleichen. Kein eigener Matcher: die Auflösung ist die des
 * FoodCatalog (`resolveLabel`: Name oder Alias, normalisiert), dieselbe wie bei
 * Präferenzen (recipes/personalization.ts).
 *
 * Reihenfolge (wie bei den Präferenzen, Kapitel 13):
 *  1. Food-ID: zeigt das Pantry Item (`ingredientId`) oder sein Name auf ein
 *     kuratiertes Food und hat das Rezept strukturierte Zutaten, entscheidet
 *     allein `RecipeIngredient.foodId`. Kein Textabgleich mehr, deshalb trifft
 *     "Reis" nie "Reiswaffeln".
 *  2. Text-Fallback nur dort, wo es keine ID gibt: freie/unbekannte Pantry-Zutat
 *     ("Rosenkohl") oder Altrezept ohne strukturierte Zutaten.
 */

export interface PantryFoodSource {
  name: string;
  ingredientId?: string | null;
}

/**
 * Zentrale Foods, auf die ein Pantry Item zeigt. Leer = freie/unbekannte Zutat.
 * Ein `ingredientId`, das auf ein kuratiertes Food zeigt, gilt zuerst; sonst
 * löst der Name über Katalog und Aliase auf ("Hühnchen" -> Hähnchenbrust), auch
 * wenn das Item früher als freie Zutat angelegt wurde.
 */
export function resolvePantryFoodIds(item: PantryFoodSource, catalog: FoodCatalog): string[] {
  if (item.ingredientId && catalog.get(item.ingredientId)) return [item.ingredientId];
  return catalog.resolveLabel(item.name).map((food) => food.id);
}

/**
 * Das EINE Food, dem ein Begriff sicher zugeordnet werden darf (Name oder Alias).
 * Mehrdeutige Begriffe (Alias gehört zu mehreren Foods, ohne dass einer exakt
 * so heißt) liefern `null`: lieber eine freie Zutat als ein geratenes Food.
 */
export function resolveUniqueFood(label: string, catalog: FoodCatalog): CatalogFood | null {
  const candidates = catalog.resolveLabel(label);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;
  const exact = candidates.filter((food) => normalizeFoodLabel(food.name) === normalizeFoodLabel(label));
  return exact.length === 1 ? exact[0] : null;
}

/** Pantry-Name -> zentrale Food-IDs; nur Items, die auf ein Food zeigen. Freie Zutaten fehlen bewusst. */
export function buildPantryFoodIdsByName(items: PantryFoodSource[], catalog: FoodCatalog): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const item of items) {
    const ids = resolvePantryFoodIds(item, catalog);
    if (ids.length === 0) continue;
    const known = byName.get(item.name) ?? [];
    byName.set(item.name, [...new Set([...known, ...ids])]);
  }
  return byName;
}

export interface RecipeIngredientsView {
  /** Zutatenzeilen als Text (bei Katalogrezepten aus den strukturierten Zutaten formatiert). */
  ingredients: string[];
  /** Strukturierte Zutaten (nur Katalogrezepte); fehlen sie, gilt der Text. */
  structured?: StructuredIngredient[];
}

/**
 * Kommt die Pantry-Zutat im Rezept vor? `foodIdsByName` (Pantry-Name -> Food-IDs,
 * siehe buildPantryFoodIdsByName) fehlt oder enthält den Namen nicht = freie
 * Zutat -> Textabgleich wie bisher.
 */
export function recipeUsesPantryIngredient(
  recipe: RecipeIngredientsView,
  pantryName: string,
  foodIdsByName?: ReadonlyMap<string, readonly string[]>,
): boolean {
  const foodIds = foodIdsByName?.get(pantryName);
  if (foodIds && foodIds.length > 0 && recipe.structured && recipe.structured.length > 0) {
    return recipe.structured.some((ingredient) => foodIds.includes(ingredient.foodId));
  }
  return ingredientListIncludes(recipe.ingredients, pantryName);
}
