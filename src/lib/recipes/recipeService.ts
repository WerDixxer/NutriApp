import { prisma } from "../db";
import type { RecipePersonalizationInput } from "../recipeDetail";
import { FoodCatalog } from "./catalog";
import {
  matchRecipeToPreferences,
  personalizeRecipe,
  resolvePreferences,
  type PersonalizedRecipe,
  type PreferenceLabels,
  type RecipePreferenceMatch,
} from "./personalization";
import {
  RECIPE_UNITS,
  type AlternativeType,
  type CatalogEdge,
  type CatalogFood,
  type DietClass,
  type RecipeUnit,
  type StructuredIngredient,
  type UnitGrams,
} from "./types";

type IngredientRow = Awaited<ReturnType<typeof prisma.ingredient.findMany>>[number];

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToCatalogFood(row: IngredientRow): CatalogFood {
  const hasNutrition = row.kcalPer100 !== null;
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    name: row.name,
    category: row.category ?? "other",
    dietClass: (row.dietClass as DietClass | null) ?? "omnivore",
    allergens: parseJson<string[]>(row.allergens, []),
    aliases: parseJson<string[]>(row.aliases, []),
    negligible: row.negligible,
    unitGrams: parseJson<UnitGrams | undefined>(row.unitGrams, undefined),
    nutrition: hasNutrition
      ? {
          kcal: row.kcalPer100 ?? 0,
          proteinG: row.proteinPer100G ?? 0,
          carbsG: row.carbsPer100G ?? 0,
          fatG: row.fatPer100G ?? 0,
          fiberG: row.fiberPer100G ?? 0,
          sugarG: row.sugarPer100G ?? 0,
          saturatedFatG: row.saturatedFatPer100G ?? 0,
          sodiumMg: row.sodiumPer100Mg ?? 0,
        }
      : null,
  };
}

/** Lädt die kuratierten Foods (mit Slug) samt Alternativen aus der zentralen Food-Tabelle. */
export async function loadFoodCatalog(): Promise<FoodCatalog> {
  const [foods, alternatives] = await Promise.all([
    prisma.ingredient.findMany({ where: { slug: { not: null } } }),
    prisma.ingredientAlternative.findMany(),
  ]);

  const edges: CatalogEdge[] = alternatives.map((a) => ({
    fromId: a.fromFoodId,
    toId: a.toFoodId,
    type: a.type as AlternativeType,
    requiresContext: a.requiresContext,
    ...(a.note ? { note: a.note } : {}),
  }));
  return new FoodCatalog(foods.map(rowToCatalogFood), edges);
}

/** Strukturierte Zutaten je Rezept-ID; Rezepte ohne strukturierte Zeilen (Altbestand, eigene Rezepte) fehlen in der Map. */
export async function loadStructuredIngredients(recipeIds: string[]): Promise<Map<string, StructuredIngredient[]>> {
  if (recipeIds.length === 0) return new Map();
  const rows = await prisma.recipeIngredient.findMany({
    where: { recipeId: { in: recipeIds }, foodId: { not: null } },
    orderBy: [{ recipeId: "asc" }, { position: "asc" }],
  });

  const byRecipe = new Map<string, StructuredIngredient[]>();
  for (const row of rows) {
    const list = byRecipe.get(row.recipeId) ?? [];
    list.push({
      foodId: row.foodId!,
      displayName: row.displayName,
      amount: row.amount,
      unit: row.unit && (RECIPE_UNITS as readonly string[]).includes(row.unit) ? (row.unit as RecipeUnit) : null,
      optional: row.optional,
      ...(row.note ? { note: row.note } : {}),
      ...(row.gramsOverride !== null ? { gramsOverride: row.gramsOverride } : {}),
    });
    byRecipe.set(row.recipeId, list);
  }
  return byRecipe;
}

/** Bestehende Präferenz-Labels des Profils (ProfileTag), unverändert als Freitext. */
export async function loadPreferenceLabels(profileId: string): Promise<PreferenceLabels> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { likedFoods: { select: { label: true } }, dislikedFoods: { select: { label: true } } },
  });
  return {
    favoriteFoods: profile?.likedFoods.map((t) => t.label) ?? [],
    dislikedFoods: profile?.dislikedFoods.map((t) => t.label) ?? [],
  };
}

/** Nur für tatsächlich angepasste Rezepte ein Wert, sonst `undefined` (Rezept bleibt Original). */
export function toPersonalizationInput(personalized: PersonalizedRecipe | null | undefined): RecipePersonalizationInput | undefined {
  if (!personalized || !personalized.adapted) return undefined;
  const n = personalized.nutrition.perServing;
  return {
    ingredientLines: personalized.ingredientLines,
    kcal: n.kcal,
    proteinG: n.proteinG,
    carbsG: n.carbsG,
    fatG: n.fatG,
    swaps: personalized.swaps.map((s) => ({ from: s.fromName, to: s.toName })),
  };
}

export interface RecipeForPersonalization {
  id: string;
  servings: number;
  /** Recipe.ingredients (Freitext), Rückfall für Rezepte ohne strukturierte Zeilen. */
  ingredients: string;
}

export interface RecipeAnalysis {
  match: RecipePreferenceMatch;
  /** Nur gesetzt, wenn das Rezept strukturierte Zutaten hat. */
  personalized: PersonalizedRecipe | null;
}

/**
 * Präferenz-Match + personalisierte Variante für eine Liste von Rezepten
 * (ein Katalog-Load, eine Zutaten-Query, eine Profil-Query). Rezepte ohne
 * strukturierte Zutaten laufen weiter über den Freitext-Abgleich wie bisher
 * und werden nie personalisiert.
 */
export async function analyzeRecipesForProfile(
  profileId: string,
  recipes: RecipeForPersonalization[],
): Promise<Map<string, RecipeAnalysis>> {
  const result = new Map<string, RecipeAnalysis>();
  if (recipes.length === 0) return result;

  const [catalog, labels, structured] = await Promise.all([
    loadFoodCatalog(),
    loadPreferenceLabels(profileId),
    loadStructuredIngredients(recipes.map((r) => r.id)),
  ]);
  const preferences = resolvePreferences(labels, catalog);

  for (const recipe of recipes) {
    const ingredients = structured.get(recipe.id) ?? [];
    const match = matchRecipeToPreferences(
      { ingredients, ingredientLines: parseJson<string[]>(recipe.ingredients, []) },
      preferences,
      catalog,
    );
    const personalized =
      ingredients.length > 0 ? personalizeRecipe({ servings: recipe.servings, ingredients }, preferences, catalog) : null;
    result.set(recipe.id, { match, personalized });
  }
  return result;
}
