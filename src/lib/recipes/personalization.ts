import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import { recipeBlockedByAllergies, resolveAllergyLabels } from "./allergens";
import { deriveAllergens, deriveDietClass } from "./diet";
import { computeRecipeNutrition, roundNutrition, type NutritionResult } from "./nutrition";
import type { AlternativeType, CatalogFood, DietClass, RecipeUnit, StructuredIngredient } from "./types";
import { formatAmount, formatIngredientLine, ingredientGrams } from "./units";

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

  // Das Label ist ein bekanntes Food und das Rezept ist strukturiert: kein Treffer über den Text.
  // Sonst würde "Reis" die "Reiswaffeln" treffen. Der Textabgleich bleibt für unbekannte Labels
  // (oben) und für Altrezepte ohne strukturierte Zutaten.
  return null;
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

/** Warum eine Zutat ersetzt wurde. Allergie hat Vorrang vor Abneigung vor Lieblingsfood. */
export type SwapReason = "allergen" | "disliked_food" | "favorite_food";

export interface IngredientSwap {
  ingredientIndex: number;
  fromFoodId: string;
  fromName: string;
  toFoodId: string;
  toName: string;
  type: AlternativeType;
  /** Label des Lieblingsfoods, wenn das gewählte Food eines ist; sonst null. */
  favoriteLabel: string | null;
  /** Menge und Einheit sind die des Originals: gleiche Menge, gleiche Einheit. */
  amount: number | null;
  unit: RecipeUnit | null;
  reason: SwapReason;
}

export interface PersonalizedRecipe {
  /** true, sobald mindestens eine Zutat ersetzt wurde ("Für dich angepasst"). */
  adapted: boolean;
  swaps: IngredientSwap[];
  ingredients: StructuredIngredient[];
  ingredientLines: string[];
  /** Neu aus den tatsächlich verwendeten Foods berechnet, NICHT die festen Rezeptwerte. */
  nutrition: NutritionResult;
  originalNutrition: NutritionResult;
  allergens: string[];
  dietClass: DietClass;
  /**
   * Ergebnis der zentralen Allergen-Auflösung (allergens.ts) für Original und Variante; ohne
   * übergebene Allergien immer false. Eine Variante gilt nie als allergiefrei, nur weil sie
   * ersetzt wurde: nur wenn die Auflösung sie für die Allergien nicht mehr sperrt.
   */
  allergyBlocked: { original: boolean; personalized: boolean };
}

export interface PersonalizeOptions {
  /** Abneigungen durch eine passende Alternative ersetzen (Rezeptkatalog, vom Nutzer angefordert). Standard: aus. */
  replaceDisliked?: boolean;
  /**
   * Allergien/Intoleranzen des Nutzers (Freitext, Auflösung wie überall: allergens.ts). Gesetzt:
   *  - Alternativen, die dagegen verstoßen, sind nie zulässig (auch kein Lieblingsfood),
   *  - allergene Zutaten werden ersetzt, sofern eine sichere Alternative existiert.
   * Enthält die Angabe Begriffe außerhalb des Allergen-Vokabulars, lässt sich keine Alternative
   * bestätigen: dann wird nichts ersetzt (unbekannt gilt nie als sicher).
   */
  allergyLabels?: string[];
}

/**
 * Welche Kantentypen für welchen Anlass als Ersatz in Frage kommen. Abneigung: nur
 * gleichwertige Alternativen ("similar"), damit aus "mag Skyr nicht" kein Umstieg auf
 * Sojajoghurt oder laktosefreien Skyr wird. Allergie: zusätzlich die diätetischen Typen, denn
 * dafür sind sie gepflegt (glutenfrei, milchfrei, ...); die Allergen-Auflösung entscheidet
 * dann, ob das konkrete Food sicher ist. Lieblingsfood: jeder Typ, der Nutzer hat das Ziel gewählt.
 */
const REPLACEMENT_TYPES: Record<SwapReason, readonly AlternativeType[] | null> = {
  allergen: ["similar", "dietary", "vegan", "dairy-free", "lactose-free", "gluten-free"],
  disliked_food: ["similar"],
  favorite_food: null,
};

interface ReplacementContext {
  catalog: FoodCatalog;
  dislikedFoodIds: Set<string>;
  /** Lieblingsfoods in der Reihenfolge der Nutzerangabe. */
  favorites: ResolvedLabel[];
  allergyLabels: string[];
  /** Allergie-Angaben, die sich nicht auf das Vokabular abbilden lassen: keine Alternative ist verifizierbar. */
  unverifiable: boolean;
}

function canComputeNutrition(ingredient: StructuredIngredient, food: CatalogFood): boolean {
  if (ingredient.amount === null || food.negligible) return true;
  return ingredientGrams(ingredient, food) !== null && food.nutrition !== null;
}

function foodConflictsWithAllergies(food: CatalogFood, displayName: string, allergyLabels: string[], catalog: FoodCatalog): boolean {
  return recipeBlockedByAllergies(food.allergens, allergyLabels, [food.name, displayName], catalog);
}

/**
 * Wählt für EINE Zutat die Alternative: nur gepflegte, nicht kontextabhängige Kanten des
 * Anlasses; nie ein abgelehntes oder für die Allergien unsicheres Food; nur wenn die Nährwerte
 * des Ersatzes berechenbar sind. Unter mehreren gültigen gewinnt ein Lieblingsfood (in der Reihenfolge
 * der Angabe), sonst die erste Kante in der gepflegten Reihenfolge. Kein Scoring.
 */
function chooseReplacement(
  ingredient: StructuredIngredient,
  source: CatalogFood,
  reason: SwapReason,
  ctx: ReplacementContext,
): { target: CatalogFood; type: AlternativeType } | null {
  const allowed = REPLACEMENT_TYPES[reason];
  const sourceComputable = canComputeNutrition(ingredient, source);

  // Sichere Kandidaten jedes Typs: nicht kontextabhängig, nicht abgelehnt, für die Allergien sicher, berechenbar.
  const safe = ctx.catalog.alternativesFor(source.id).flatMap((edge) => {
    if (edge.requiresContext) return [];
    const target = ctx.catalog.get(edge.toId);
    if (!target || target.id === source.id || ctx.dislikedFoodIds.has(target.id)) return [];
    if (ctx.allergyLabels.length > 0 && (ctx.unverifiable || foodConflictsWithAllergies(target, target.name, ctx.allergyLabels, ctx.catalog))) return [];
    if (sourceComputable && !canComputeNutrition({ ...ingredient, foodId: target.id }, target)) return [];
    return [{ target, type: edge.type }];
  });

  // Ein Lieblingsfood ist ein ausdrücklicher Wunsch und darf jeden sicheren Kantentyp wählen ...
  for (const favorite of ctx.favorites) {
    for (const foodId of favorite.foodIds) {
      const match = safe.find((c) => c.target.id === foodId);
      if (match) return match;
    }
  }
  // ... sonst gilt die erste gleichwertige Alternative des Anlasses in der gepflegten Reihenfolge.
  return reason === "favorite_food" ? null : (safe.find((c) => !allowed || allowed.includes(c.type)) ?? null);
}

/**
 * Baut die personalisierte Variante: pro Zutat höchstens EIN Ersatz mit gleicher Menge und
 * Einheit; das Original bleibt unverändert (es entsteht eine neue Zutatenliste, nichts wird
 * gespeichert). Anlässe in dieser Reihenfolge:
 *  1. Allergie (nur mit `allergyLabels`): die Zutat verstößt laut zentraler Auflösung; Ersatz nur, wenn sicher,
 *  2. schon ein Lieblingsfood: unangetastet,
 *  3. Abneigung (nur mit `replaceDisliked`): Ersatz durch eine gleichwertige Alternative,
 *  4. Lieblingsfood als Ziel: eine Kante des Foods zu einem Lieblingsfood.
 * Kontextabhängige Kanten (`requiresContext`) werden nie automatisch eingesetzt. Ein Lieblingsfood
 * ist nur ein Vorzug innerhalb der zulässigen Alternativen und überstimmt nie die Allergie-Prüfung.
 * Nährwerte, Allergene und Ernährungsform werden aus den gewählten Foods neu berechnet
 * (computeRecipeNutrition, derselbe Weg wie beim Original).
 */
export function personalizeRecipe(
  recipe: { servings: number; ingredients: StructuredIngredient[] },
  preferences: ResolvedPreferences,
  catalog: FoodCatalog,
  options: PersonalizeOptions = {},
): PersonalizedRecipe {
  const allergyLabels = (options.allergyLabels ?? []).filter((l) => l.trim());
  const ctx: ReplacementContext = {
    catalog,
    dislikedFoodIds: new Set(preferences.dislikes.flatMap((d) => d.foodIds)),
    favorites: preferences.favorites,
    allergyLabels,
    unverifiable: allergyLabels.length > 0 && resolveAllergyLabels(allergyLabels).unresolvedTerms.length > 0,
  };
  const favoriteFoodIds = new Set(preferences.favorites.flatMap((f) => f.foodIds));
  const swaps: IngredientSwap[] = [];

  const ingredients = recipe.ingredients.map((ingredient, ingredientIndex) => {
    const source = catalog.get(ingredient.foodId);
    if (!source) return ingredient;

    let reason: SwapReason;
    if (allergyLabels.length > 0 && foodConflictsWithAllergies(source, ingredient.displayName, allergyLabels, catalog)) {
      reason = "allergen";
    } else if (favoriteFoodIds.has(ingredient.foodId)) {
      return ingredient;
    } else if (options.replaceDisliked && ctx.dislikedFoodIds.has(ingredient.foodId)) {
      reason = "disliked_food";
    } else {
      reason = "favorite_food";
    }

    const choice = chooseReplacement(ingredient, source, reason, ctx);
    if (!choice) return ingredient;

    swaps.push({
      ingredientIndex,
      fromFoodId: source.id,
      fromName: source.name,
      toFoodId: choice.target.id,
      toName: choice.target.name,
      type: choice.type,
      favoriteLabel: preferences.favorites.find((f) => f.foodIds.includes(choice.target.id))?.label ?? null,
      amount: ingredient.amount,
      unit: ingredient.unit,
      reason,
    });
    return { ...ingredient, foodId: choice.target.id, displayName: choice.target.name };
  });

  const ingredientLines = ingredients.map(formatIngredientLine);
  const allergens = deriveAllergens(ingredients, catalog);
  const originalLines = recipe.ingredients.map(formatIngredientLine);
  const blocked = (foodAllergens: string[], lines: string[]) =>
    allergyLabels.length > 0 && recipeBlockedByAllergies(foodAllergens, allergyLabels, lines, catalog);

  return {
    adapted: swaps.length > 0,
    swaps,
    ingredients,
    ingredientLines,
    nutrition: computeRecipeNutrition(ingredients, recipe.servings, catalog),
    originalNutrition: computeRecipeNutrition(recipe.ingredients, recipe.servings, catalog),
    allergens,
    dietClass: deriveDietClass(ingredients, catalog),
    allergyBlocked: {
      original: blocked(deriveAllergens(recipe.ingredients, catalog), originalLines),
      personalized: blocked(allergens, ingredientLines),
    },
  };
}

// ---------------------------------------------------------------------------
// Darstellung für die UI (serialisierbar, frei von DB-Zugriff)
// ---------------------------------------------------------------------------

export interface ReplacementView {
  fromName: string;
  toName: string;
  /** "100 g", "2 Stück", ...; null bei Zutaten ohne Mengenangabe. Gleich für Original und Ersatz. */
  quantity: string | null;
  reason: SwapReason;
}

/** Die angepasste Variante, wie der Rezept-Dialog sie neben dem Original zeigt. */
export interface PersonalizedVariant {
  ingredientLines: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  replacements: ReplacementView[];
  /** Auch die Variante enthält laut zentraler Allergen-Auflösung noch Allergene des Profils. */
  stillBlockedByAllergy: boolean;
}

function formatQuantity(amount: number | null, unit: RecipeUnit | null): string | null {
  if (amount === null || unit === null) return null;
  if (unit === "piece") return `${formatAmount(amount)} Stück`;
  return formatIngredientLine({ amount, unit, displayName: "", optional: false }).trim();
}

/** `null`, wenn nichts ersetzt wurde: dann gibt es keine Variante anzubieten. */
export function toPersonalizedVariant(personalized: PersonalizedRecipe): PersonalizedVariant | null {
  if (!personalized.adapted) return null;
  const n = roundNutrition(personalized.nutrition.perServing);
  return {
    ingredientLines: personalized.ingredientLines,
    kcal: n.kcal,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    replacements: personalized.swaps.map((s) => ({
      fromName: s.fromName,
      toName: s.toName,
      quantity: formatQuantity(s.amount, s.unit),
      reason: s.reason,
    })),
    stillBlockedByAllergy: personalized.allergyBlocked.personalized,
  };
}
