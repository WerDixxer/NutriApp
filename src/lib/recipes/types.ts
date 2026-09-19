/**
 * Gemeinsame Typen der Rezept-/Food-Grundlage. Bewusst ohne Prisma-Import:
 * die Logik in src/lib/recipes/ arbeitet auf diesen schlanken Formen und ist
 * dadurch sowohl gegen die Seed-Daten (id = slug) als auch gegen DB-Zeilen
 * (id = cuid) testbar, siehe catalog.ts.
 */

/** Restriktivste Ernährungsform, mit der ein Food/Rezept vereinbar ist. */
export const DIET_CLASSES = ["vegan", "vegetarian", "pescatarian", "omnivore"] as const;
export type DietClass = (typeof DIET_CLASSES)[number];

/** Je höher, desto weniger restriktiv (ein veganes Rezept passt zu jeder Form). */
export const DIET_CLASS_RANK: Record<DietClass, number> = {
  vegan: 0,
  vegetarian: 1,
  pescatarian: 2,
  omnivore: 3,
};

export const ALTERNATIVE_TYPES = [
  "similar",
  "dietary",
  "vegan",
  "dairy-free",
  "lactose-free",
  "gluten-free",
  "lower-calorie",
  "higher-protein",
] as const;
export type AlternativeType = (typeof ALTERNATIVE_TYPES)[number];

export const RECIPE_UNITS = ["g", "ml", "tl", "el", "piece", "slice", "can", "pinch"] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];

/** Nährwerte je 100 g (bei Flüssigkeiten je 100 ml). Gleiche Feldnamen wie NutritionProviderProduct.per100g. */
export interface Per100 {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  saturatedFatG: number;
  sodiumMg: number;
}

/** Gramm je Einheit; `ml` ist die Dichte (g je ml), Default 1. */
export type UnitGrams = Partial<Record<"ml" | "piece" | "slice" | "tl" | "el" | "can", number>>;

export interface FoodDef {
  /** Stabile, lesbare Food-ID, z.B. "skyr". Erscheint in Rezepten und Alternativen. */
  slug: string;
  name: string;
  category: string;
  dietClass: DietClass;
  /** Gleiches Vokabular wie Recipe.allergens: milch, gluten, ei, soja, erdnuss, nüsse, sesam, fisch, ... */
  allergens: string[];
  /** Alternative Schreibweisen/Oberbegriffe, mit denen Nutzer das Food benennen ("Hähnchen"). */
  aliases: string[];
  /** null bei Gewürzen und bewusst nicht bezifferten Foods. */
  nutrition: Per100 | null;
  /** Gewürz o.ä.: trägt nie zu Nährwerten bei. */
  negligible?: boolean;
  unitGrams?: UnitGrams;
  note?: string;
}

export interface AlternativeDef {
  from: string;
  to: string;
  type: AlternativeType;
  /** true = passt nur je nach Rezept, wird nie automatisch eingesetzt. */
  requiresContext: boolean;
  note?: string;
}

/** Ein Food im Laufzeit-Katalog. `id` ist slug (Seed-Daten) oder DB-cuid. */
export interface CatalogFood extends FoodDef {
  id: string;
}

export interface CatalogEdge {
  fromId: string;
  toId: string;
  type: AlternativeType;
  requiresContext: boolean;
  note?: string;
}

export interface StructuredIngredient {
  foodId: string;
  displayName: string;
  amount: number | null;
  unit: RecipeUnit | null;
  optional: boolean;
  note?: string;
  gramsOverride?: number;
}

export interface NutritionPerServing {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
  saturatedFatG: number;
  sodiumMg: number;
}
