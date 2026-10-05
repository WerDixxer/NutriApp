import { prisma } from "../db";
import type { RecipePersonalizationInput } from "../recipeDetail";
import { FoodCatalog } from "./catalog";
import type { BrowsePreferences, BrowseRecipe } from "./catalogBrowser";
import type { QualityIngredientRow, QualityRecipeInput } from "./catalogQuality";
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
  isDietClass,
  type AlternativeType,
  type CatalogEdge,
  type CatalogFood,
  type DietClass,
  type RecipeUnit,
  type StructuredIngredient,
  type UnitGrams,
} from "./types";
import { formatIngredientLine } from "./units";
import { readRecipeDietTypes, readRecipeMealSlots, readRecipeStringList } from "./recipeJsonColumns";
import { JsonColumnError, readJsonColumn, reportUnreadableJsonColumn, skipUnreadableRows } from "../validation/jsonColumn";
import { storedStringListSchema, storedUnitGramsSchema } from "../validation/jsonColumnSchemas";

type IngredientRow = Awaited<ReturnType<typeof prisma.ingredient.findMany>>[number];

/**
 * Bisheriges Verhalten dieser Datei für unlesbare JSON-Spalten: Standardwert statt Fehler. Das bleibt
 * für die Food-Zeilen (`loadFoodCatalog` läuft in fast jedem Request) und die Audit-/Match-Eingaben so,
 * die Spalte wird aber jetzt per Schema geprüft und ein Fallback protokolliert statt still übergangen
 * (R5D). Der Fallback gilt nur im Speicher, zurückgeschrieben wird nichts.
 */
function readOrFallback<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof JsonColumnError)) throw error;
    reportUnreadableJsonColumn(error, "Es wird der Standardwert verwendet.");
    return fallback;
  }
}

function readFoodStringList(row: IngredientRow, column: "allergens" | "aliases"): string[] {
  return readOrFallback(() => readJsonColumn({ model: "Ingredient", id: row.id, column }, row[column], storedStringListSchema), []);
}

function readFoodUnitGrams(row: IngredientRow): UnitGrams | undefined {
  const value = row.unitGrams;
  if (value === null) return undefined;
  return readOrFallback(() => readJsonColumn({ model: "Ingredient", id: row.id, column: "unitGrams" }, value, storedUnitGramsSchema), undefined);
}

/**
 * `Ingredient.dietClass` ist eine String-Spalte. Fehlt sie oder ist der Wert unbekannt, gilt das Food
 * konservativ als omnivore (wie unbekannte Foods in deriveDietClass) - ein unbekannter Wert meldet sich
 * mit Warnung, statt ein Rezept still als vegan durchgehen zu lassen.
 */
function catalogDietClass(row: IngredientRow): DietClass {
  if (row.dietClass === null) return "omnivore";
  if (isDietClass(row.dietClass)) return row.dietClass;
  console.warn(`[food-catalog] Ingredient ${row.id}: unbekannte dietClass "${row.dietClass}", gilt konservativ als omnivore.`);
  return "omnivore";
}

function rowToCatalogFood(row: IngredientRow): CatalogFood {
  const hasNutrition = row.kcalPer100 !== null;
  return {
    id: row.id,
    slug: row.slug ?? row.id,
    name: row.name,
    category: row.category ?? "other",
    dietClass: catalogDietClass(row),
    allergens: readFoodStringList(row, "allergens"),
    aliases: readFoodStringList(row, "aliases"),
    negligible: row.negligible,
    unitGrams: readFoodUnitGrams(row),
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

/**
 * Hängt die strukturierten Zutaten an Rezept-Kandidaten (Planer, Suche,
 * Entscheidung), damit die gemeinsame Präferenz-Auflösung (foodPreferences.ts)
 * über Food-IDs arbeitet. Altrezepte und eigene Rezepte haben keine Zeilen und
 * bleiben unverändert (Textabgleich).
 */
export async function attachStructuredIngredients<T extends { id: string; structured?: StructuredIngredient[] }>(
  candidates: T[],
): Promise<T[]> {
  const structured = await loadStructuredIngredients(candidates.map((c) => c.id));
  for (const candidate of candidates) {
    const rows = structured.get(candidate.id);
    if (rows) candidate.structured = rows;
  }
  return candidates;
}

export interface CatalogEntry {
  recipe: BrowseRecipe;
  /** Die Datenbankzeile, aus der das bestehende Detail (dbRecipeToDetail) gebaut wird. */
  row: RecipeRow;
}
type RecipeRow = Awaited<ReturnType<typeof prisma.recipe.findMany>>[number];

/**
 * Die strukturierten Katalog-Rezepte (Rezepte mit slug; eigene und ältere Rezepte
 * ohne strukturierte Zutaten gehören nicht dazu) samt ihren RecipeIngredient-Zeilen.
 * Reihenfolge stabil: Anlagereihenfolge des Seeds, dann Name.
 */
export async function loadCatalogRecipes(): Promise<CatalogEntry[]> {
  const rows = await prisma.recipe.findMany({
    where: { slug: { not: null } },
    orderBy: [{ createdAt: "asc" }, { name: "asc" }],
  });
  const structured = await loadStructuredIngredients(rows.map((r) => r.id));

  // Ein Rezept mit unlesbarer JSON-Spalte fällt mit Warnung aus dem Katalog, statt z.B. mit
  // leerer Allergenliste angezeigt zu werden (R5D).
  return skipUnreadableRows(rows, (row) => {
    const ingredients = structured.get(row.id) ?? [];
    const recipe: BrowseRecipe = {
      id: row.id,
      slug: row.slug ?? row.id,
      name: row.name,
      description: row.description,
      kcal: row.kcal,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      timeMin: row.totalTimeMin ?? row.prepTimeMin,
      servings: row.servings,
      mealSlots: readRecipeMealSlots(row),
      dietTypes: readRecipeDietTypes(row),
      tags: readRecipeStringList(row, "tags"),
      mealPrepSuitable: row.mealPrepSuitable,
      cuisine: row.cuisine,
      allergens: readRecipeStringList(row, "allergens"),
      ingredients,
      ingredientLines: ingredients.length > 0 ? ingredients.map(formatIngredientLine) : readRecipeStringList(row, "ingredients"),
    };
    return { recipe, row };
  });
}

/**
 * Alle Rezepte des GLOBALEN Katalogs für den Quality-/Duplikat-Report (Kapitel 18), die interne
 * Review-Queue und die Duplikatprüfung von Importen: anders als `loadCatalogRecipes` ohne
 * `slug`-Filter (auch die 30 Altrezepte) und mit den ROHEN RecipeIngredient-Zeilen - bewusst OHNE
 * den `foodId: { not: null }}`-Filter von `loadStructuredIngredients`, damit der Audit fehlende
 * Food-Referenzen selbst sehen und melden kann. Private eigene Rezepte (`isCustom`) gehören
 * Nutzern, nicht dem Katalog: sie tauchen hier nie auf (weder als Name in internen Werkzeugen noch
 * als Duplikat eines Imports). Rein lesend, keine Schreiboperation.
 */
export async function loadCatalogQualityInputs(): Promise<QualityRecipeInput[]> {
  const [rows, ingredientRows] = await Promise.all([
    prisma.recipe.findMany({ where: { isCustom: false }, orderBy: [{ createdAt: "asc" }, { name: "asc" }] }),
    prisma.recipeIngredient.findMany({ where: { recipe: { isCustom: false } }, orderBy: [{ recipeId: "asc" }, { position: "asc" }] }),
  ]);

  const byRecipe = new Map<string, QualityIngredientRow[]>();
  for (const row of ingredientRows) {
    const list = byRecipe.get(row.recipeId) ?? [];
    list.push({
      foodId: row.foodId,
      displayName: row.displayName,
      amount: row.amount,
      unit: row.unit && (RECIPE_UNITS as readonly string[]).includes(row.unit) ? (row.unit as RecipeUnit) : null,
      optional: row.optional,
      ...(row.gramsOverride !== null ? { gramsOverride: row.gramsOverride } : {}),
    });
    byRecipe.set(row.recipeId, list);
  }

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    servings: row.servings,
    structuredIngredients: byRecipe.get(row.id) ?? [],
    freeTextIngredients: readOrFallback(() => readRecipeStringList(row, "ingredients"), []),
    tags: readOrFallback(() => readRecipeStringList(row, "tags"), []),
  }));
}

/** Allergien, Lieblinge und Abneigungen des Profils (ProfileTag), unverändert als Freitext. */
export async function loadBrowsePreferences(profileId: string): Promise<BrowsePreferences> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: {
      allergies: { select: { label: true } },
      likedFoods: { select: { label: true } },
      dislikedFoods: { select: { label: true } },
    },
  });
  return {
    allergyLabels: profile?.allergies.map((t) => t.label) ?? [],
    favoriteFoods: profile?.likedFoods.map((t) => t.label) ?? [],
    dislikedFoods: profile?.dislikedFoods.map((t) => t.label) ?? [],
  };
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
      { ingredients, ingredientLines: readOrFallback(() => readRecipeStringList(recipe, "ingredients"), []) },
      preferences,
      catalog,
    );
    const personalized =
      ingredients.length > 0 ? personalizeRecipe({ servings: recipe.servings, ingredients }, preferences, catalog) : null;
    result.set(recipe.id, { match, personalized });
  }
  return result;
}
