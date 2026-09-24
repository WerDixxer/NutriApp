import { primaryCategory } from "./tags";

/**
 * Rezepttyp für die visuelle Einordnung (Icon + kurzer Text) im Rezeptkatalog. Wird aus den
 * vorhandenen Daten abgeleitet, nichts davon ist gespeichert:
 *  1. Meal Slots des Rezepts,
 *  2. passender Rezept-Tag (die Hauptkategorie, `primaryCategory`),
 *  3. neutrales Fallback.
 * Immer genau EIN Typ, nie mehrere widersprüchliche Kategorien.
 */
export type RecipeTypeKey = "breakfast" | "meal" | "snack" | "pre-workout" | "post-workout" | "other";

/** Namen der lucide-Icons (bestehendes Icon-System des Projekts); die Zuordnung zur Komponente steht in components/RecipeTypeIcon.tsx. */
export type RecipeTypeIcon = "Sunrise" | "Utensils" | "Apple" | "Zap" | "Dumbbell" | "ChefHat";

export interface RecipeType {
  key: RecipeTypeKey;
  /** Kurze Einordnung auf Karte und Detail. */
  label: string;
  icon: RecipeTypeIcon;
}

export const RECIPE_TYPES: Record<RecipeTypeKey, RecipeType> = {
  breakfast: { key: "breakfast", label: "Frühstück", icon: "Sunrise" },
  meal: { key: "meal", label: "Vollwertige Mahlzeit", icon: "Utensils" },
  snack: { key: "snack", label: "Snack", icon: "Apple" },
  "pre-workout": { key: "pre-workout", label: "Vor dem Training", icon: "Zap" },
  "post-workout": { key: "post-workout", label: "Nach dem Training", icon: "Dumbbell" },
  other: { key: "other", label: "Rezept", icon: "ChefHat" },
};

/** Reihenfolge, in der der Katalog die Typen als Bereiche zeigt. */
export const RECIPE_TYPE_ORDER = ["breakfast", "meal", "snack", "pre-workout", "post-workout"] as const;

const SLOT_TYPE: Record<string, RecipeTypeKey> = {
  BREAKFAST: "breakfast",
  LUNCH: "meal",
  DINNER: "meal",
  SNACK: "snack",
  PRE_WORKOUT: "pre-workout",
  POST_WORKOUT: "post-workout",
};

const CATEGORY_TYPE: Record<string, RecipeTypeKey> = {
  breakfast: "breakfast",
  lunch: "meal",
  dinner: "meal",
  snack: "snack",
  dessert: "snack",
  "pre-workout": "pre-workout",
  "post-workout": "post-workout",
};

/** Nur als letzte Instanz, wenn Slots und Hauptkategorie keinen der Kandidaten ergeben: der spezifischere Typ zuerst. */
const PRECEDENCE: RecipeTypeKey[] = ["post-workout", "pre-workout", "breakfast", "meal", "snack"];

export function recipeType(recipe: { mealSlots: string[]; tags: string[] }): RecipeType {
  const fromSlots = [...new Set(recipe.mealSlots.map((slot) => SLOT_TYPE[slot]).filter((k): k is RecipeTypeKey => Boolean(k)))];
  const fromTag = CATEGORY_TYPE[primaryCategory(recipe.tags) ?? ""];

  // Ein Slot-Typ (Lunch + Dinner sind beide "Mahlzeit"): eindeutig.
  if (fromSlots.length === 1) return RECIPE_TYPES[fromSlots[0]];

  // Mehrere Slots (z. B. Frühstück + Nach dem Training): die Hauptkategorie des Rezepts entscheidet.
  if (fromSlots.length > 1) {
    if (fromTag && fromSlots.includes(fromTag)) return RECIPE_TYPES[fromTag];
    return RECIPE_TYPES[PRECEDENCE.find((key) => fromSlots.includes(key)) ?? "other"];
  }

  // Kein Slot: passender Tag, sonst neutral.
  return RECIPE_TYPES[fromTag ?? "other"];
}
