import { FoodCatalog, normalizeFoodLabel } from "../catalog";
import { deriveAllergens, deriveDietClass, dietTypesFor } from "../diet";
import { computeRecipeNutrition, roundNutrition } from "../nutrition";
import { mealSlotsFromTags, normalizeTag, primaryCategory, tagGroup, tagsInGroup } from "../tags";
import {
  DIET_CLASS_RANK,
  RECIPE_UNITS,
  type CatalogEdge,
  type CatalogFood,
  type DietClass,
  type NutritionPerServing,
  type StructuredIngredient,
} from "../types";
import { formatIngredientLine } from "../units";
import { ALTERNATIVES } from "./alternatives";
import { FOODS } from "./foods";
import { RECIPES, type RecipeSeed } from "./recipes";

/** Katalog aus den Seed-Daten: `id` = `slug`. Quelle für Tests und Seed-Skript. */
export function buildSeedCatalog(): FoodCatalog {
  const foods: CatalogFood[] = FOODS.map((f) => ({ ...f, id: f.slug }));
  const edges: CatalogEdge[] = ALTERNATIVES.map((a) => ({
    fromId: a.from,
    toId: a.to,
    type: a.type,
    requiresContext: a.requiresContext,
    ...(a.note ? { note: a.note } : {}),
  }));
  return new FoodCatalog(foods, edges);
}

export interface BuiltRecipe {
  slug: string;
  name: string;
  description: string;
  imageQuery: string;
  servings: number;
  tags: string[];
  category: string | null;
  mealSlots: string[];
  dietClass: DietClass;
  dietTypes: string[];
  allergens: string[];
  /** `foodId` = Food-Slug. */
  ingredients: StructuredIngredient[];
  ingredientLines: string[];
  instructions: string[];
  prepTimeMin: number;
  cookTimeMin: number;
  totalTimeMin: number;
  difficulty: "easy" | "medium";
  cuisine: string | null;
  equipment: string[];
  mealPrepSuitable: boolean;
  storageDays: number | null;
  storage: string | null;
  /** Aus den Zutaten berechneter Snapshot (gerundet); `complete` siehe nutrition.ts. */
  nutrition: NutritionPerServing;
  nutritionComplete: boolean;
  source: { type: "internal"; provider: null; externalId: null };
}

const EASY_TOTAL_MIN = 15;

export function toStructuredIngredients(seed: RecipeSeed): StructuredIngredient[] {
  return seed.ingredients.map((i) => {
    const catalogName = i.name ?? undefined;
    return {
      foodId: i.food,
      displayName: catalogName ?? FOODS.find((f) => f.slug === i.food)?.name ?? i.food,
      amount: i.amount ?? null,
      unit: i.unit ?? null,
      optional: i.optional ?? false,
      ...(i.note ? { note: i.note } : {}),
      ...(i.grams !== undefined ? { gramsOverride: i.grams } : {}),
    };
  });
}

export function buildRecipe(seed: RecipeSeed, catalog: FoodCatalog): BuiltRecipe {
  const ingredients = toStructuredIngredients(seed);
  const dietClass = deriveDietClass(ingredients, catalog);
  const nutrition = computeRecipeNutrition(ingredients, seed.servings, catalog);
  const totalTimeMin = seed.prepMin + seed.cookMin;
  const tags = seed.tags.map(normalizeTag);
  const mealPrep = tags.includes("meal-prep");

  return {
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    imageQuery: seed.name.toLowerCase(),
    servings: seed.servings,
    tags,
    category: primaryCategory(tags),
    mealSlots: mealSlotsFromTags(tags),
    dietClass,
    dietTypes: dietTypesFor(dietClass, tags),
    allergens: deriveAllergens(ingredients, catalog),
    ingredients,
    ingredientLines: ingredients.map(formatIngredientLine),
    instructions: seed.instructions,
    prepTimeMin: seed.prepMin,
    cookTimeMin: seed.cookMin,
    totalTimeMin,
    difficulty: tags.includes("easy") || totalTimeMin <= EASY_TOTAL_MIN ? "easy" : "medium",
    cuisine: seed.cuisine ?? null,
    equipment: seed.equipment,
    mealPrepSuitable: mealPrep,
    storageDays: mealPrep ? (seed.storageDays ?? null) : null,
    storage: mealPrep && seed.storageDays ? "FRIDGE" : null,
    nutrition: roundNutrition(nutrition.perServing),
    nutritionComplete: nutrition.complete,
    source: { type: "internal", provider: null, externalId: null },
  };
}

export function buildRecipes(catalog: FoodCatalog = buildSeedCatalog()): BuiltRecipe[] {
  return RECIPES.map((seed) => buildRecipe(seed, catalog));
}

/**
 * Strukturelle Prüfung der Seed-Daten (Referenzen, Eindeutigkeit, Tags).
 * Gibt eine Liste lesbarer Probleme zurück; leer = konsistent. Das Seed-Skript
 * bricht bei Problemen ab, damit keine kaputten Referenzen in die DB gelangen.
 */
export function validateSeedData(): string[] {
  const problems: string[] = [];
  const catalog = buildSeedCatalog();

  const slugs = new Set<string>();
  const names = new Map<string, string>();
  const labels = new Map<string, string>();
  for (const food of FOODS) {
    if (slugs.has(food.slug)) problems.push(`Food-Slug doppelt: ${food.slug}`);
    slugs.add(food.slug);
    const nameKey = normalizeFoodLabel(food.name);
    if (names.has(nameKey)) problems.push(`Food-Name doppelt: ${food.name} (${names.get(nameKey)})`);
    names.set(nameKey, food.slug);

    for (const label of new Set([food.name, ...food.aliases].map(normalizeFoodLabel))) {
      const owner = labels.get(label);
      if (owner && owner !== food.slug) problems.push(`Label "${label}" gehört zu ${owner} UND ${food.slug}`);
      labels.set(label, food.slug);
    }
  }

  const edgeKeys = new Set<string>();
  for (const alt of ALTERNATIVES) {
    if (!slugs.has(alt.from)) problems.push(`Alternative: unbekanntes Food (from) ${alt.from}`);
    if (!slugs.has(alt.to)) problems.push(`Alternative: unbekanntes Food (to) ${alt.to}`);
    if (alt.from === alt.to) problems.push(`Alternative verweist auf sich selbst: ${alt.from}`);
    const key = `${alt.from}->${alt.to}`;
    if (edgeKeys.has(key)) problems.push(`Alternative doppelt: ${key}`);
    edgeKeys.add(key);
  }

  const recipeSlugs = new Set<string>();
  const recipeNames = new Set<string>();
  for (const recipe of RECIPES) {
    if (recipeSlugs.has(recipe.slug)) problems.push(`Rezept-Slug doppelt: ${recipe.slug}`);
    recipeSlugs.add(recipe.slug);
    const nameKey = recipe.name.trim().toLowerCase();
    if (recipeNames.has(nameKey)) problems.push(`Rezeptname doppelt: ${recipe.name}`);
    recipeNames.add(nameKey);

    if (recipe.ingredients.length === 0) problems.push(`${recipe.slug}: keine Zutaten`);
    if (recipe.instructions.length === 0) problems.push(`${recipe.slug}: keine Anleitung`);

    for (const ingredient of recipe.ingredients) {
      if (!slugs.has(ingredient.food)) problems.push(`${recipe.slug}: unbekanntes Food ${ingredient.food}`);
      if ((ingredient.amount === undefined) !== (ingredient.unit === undefined)) {
        problems.push(`${recipe.slug}: ${ingredient.food} braucht Menge UND Einheit oder keins von beiden`);
      }
      if (ingredient.unit && !(RECIPE_UNITS as readonly string[]).includes(ingredient.unit)) {
        problems.push(`${recipe.slug}: ungültige Einheit ${ingredient.unit}`);
      }
    }

    const tags = recipe.tags.map(normalizeTag);
    for (const tag of tags) {
      if (tagGroup(tag) === "other") problems.push(`${recipe.slug}: unbekannter Tag "${tag}"`);
    }
    const dietaryTags = tagsInGroup(tags, "dietary").filter((t) => t !== "keto");
    if (dietaryTags.length !== 1) {
      problems.push(`${recipe.slug}: genau ein Ernährungs-Tag erwartet, gefunden: ${dietaryTags.join(", ") || "keins"}`);
    } else {
      const derived = deriveDietClass(toStructuredIngredients(recipe), catalog);
      if (DIET_CLASS_RANK[derived] > DIET_CLASS_RANK[dietaryTags[0] as DietClass]) {
        problems.push(`${recipe.slug}: Tag "${dietaryTags[0]}" ist falsch, die Zutaten ergeben "${derived}"`);
      }
    }
    if (mealSlotsFromTags(tags).length === 0) problems.push(`${recipe.slug}: keine Mahlzeit ableitbar`);
  }

  return problems;
}
