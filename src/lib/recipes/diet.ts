import type { FoodCatalog } from "./catalog";
import { normalizeTag } from "./tags";
import { DIET_CLASS_RANK, type DietClass, type StructuredIngredient } from "./types";

/**
 * Ernährungsform eines Rezepts = die restriktivste Klasse unter seinen Foods
 * (ein einziges Fleisch-Food macht es "omnivore"). Optionale Zutaten zählen
 * mit: wer sich strikt ernährt, soll nicht durch eine "optionale" Zutat
 * überrascht werden. Unbekannte Foods gelten konservativ als omnivore.
 */
export function deriveDietClass(ingredients: StructuredIngredient[], catalog: FoodCatalog): DietClass {
  let worst: DietClass = "vegan";
  for (const ingredient of ingredients) {
    const cls = catalog.get(ingredient.foodId)?.dietClass ?? "omnivore";
    if (DIET_CLASS_RANK[cls] > DIET_CLASS_RANK[worst]) worst = cls;
  }
  return worst;
}

/**
 * Bestehendes Schema-Vokabular von Recipe.dietTypes: die Liste aller Formen,
 * mit denen das Rezept vereinbar ist (Planner filtert per `includes`).
 * HALAL/KOSHER/PALEO werden bewusst NICHT abgeleitet: dafür fehlen belastbare
 * Food-Daten (Schlachtung, Lab, Zubereitung).
 */
export function dietTypesFor(dietClass: DietClass, tags: string[]): string[] {
  const rank = DIET_CLASS_RANK[dietClass];
  const types = ["OMNIVORE"];
  if (rank <= DIET_CLASS_RANK.pescatarian) types.push("PESCETARIAN");
  if (rank <= DIET_CLASS_RANK.vegetarian) types.push("VEGETARIAN");
  if (rank <= DIET_CLASS_RANK.vegan) types.push("VEGAN");

  const normalized = tags.map(normalizeTag);
  if (normalized.includes("keto")) types.push("KETO");
  if (normalized.includes("keto") || normalized.includes("low-carb")) types.push("LOW_CARB");
  return types;
}

/** Vereinigung der Food-Allergene (gleiches Vokabular wie Recipe.allergens), alphabetisch. */
export function deriveAllergens(ingredients: StructuredIngredient[], catalog: FoodCatalog): string[] {
  const allergens = new Set<string>();
  for (const ingredient of ingredients) {
    for (const allergen of catalog.get(ingredient.foodId)?.allergens ?? []) allergens.add(allergen);
  }
  return Array.from(allergens).sort((a, b) => a.localeCompare(b, "de"));
}
