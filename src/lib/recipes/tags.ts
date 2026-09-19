import type { NutritionPerServing } from "./types";

/**
 * Zentrale Tag-Registry. Rezepte behalten EIN flaches `tags`-Array (das
 * bestehende Feld, das Trends-Filter und Assistant bereits lesen); die
 * Gruppen aus dem Auftrag (dietary/goal/meal/sport/time) werden hier
 * abgeleitet, statt fünf weitere Spalten zu duplizieren, die auseinanderlaufen
 * könnten.
 */
export const TAG_GROUPS = {
  dietary: ["omnivore", "vegetarian", "vegan", "pescatarian", "keto"],
  goal: ["high-protein", "low-calorie", "low-carb", "high-carb", "high-fiber", "balanced"],
  meal: ["breakfast", "lunch", "dinner", "snack", "dessert", "pre-workout", "post-workout"],
  sport: [
    "pre-cardio",
    "pre-strength",
    "pre-football",
    "post-cardio",
    "post-strength",
    "post-football",
    "training-energy",
    "recovery",
  ],
  time: ["quick"],
  practical: ["easy", "meal-prep", "budget-friendly"],
} as const;

export type TagGroup = keyof typeof TAG_GROUPS | "other";

/** Ältere, deutsche Tags aus dem ursprünglichen Seed auf die kanonische Form abbilden. */
const LEGACY_TAG_ALIASES: Record<string, string> = {
  vegetarisch: "vegetarian",
  schnell: "quick",
};

export function normalizeTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  return LEGACY_TAG_ALIASES[t] ?? t;
}

export function tagGroup(tag: string): TagGroup {
  const t = normalizeTag(tag);
  for (const [group, tags] of Object.entries(TAG_GROUPS)) {
    if ((tags as readonly string[]).includes(t)) return group as TagGroup;
  }
  return "other";
}

export function tagsInGroup(tags: string[], group: keyof typeof TAG_GROUPS): string[] {
  return tags.map(normalizeTag).filter((t) => (TAG_GROUPS[group] as readonly string[]).includes(t));
}

export type MealSlotName = "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK" | "PRE_WORKOUT" | "POST_WORKOUT";

/** Leitet die planbaren Mahlzeiten-Slots (Recipe.mealSlots) aus den Tags ab; Tags mit "pre-" bzw. "post-" stehen für die Workout-Slots. */
export function mealSlotsFromTags(tags: string[]): MealSlotName[] {
  const slots = new Set<MealSlotName>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    if (t === "breakfast") slots.add("BREAKFAST");
    else if (t === "lunch") slots.add("LUNCH");
    else if (t === "dinner") slots.add("DINNER");
    else if (t === "snack" || t === "dessert") slots.add("SNACK");
    else if (t.startsWith("pre-")) slots.add("PRE_WORKOUT");
    else if (t.startsWith("post-")) slots.add("POST_WORKOUT");
  }
  return Array.from(slots);
}

export type SportName = "football" | "strength" | "cardio";

/** "pre-football" / "post-football" -> "football". */
export function sportsFromTags(tags: string[]): SportName[] {
  const sports = new Set<SportName>();
  for (const raw of tags) {
    const t = normalizeTag(raw);
    for (const sport of ["football", "strength", "cardio"] as const) {
      if (t.endsWith(`-${sport}`)) sports.add(sport);
    }
  }
  return Array.from(sports);
}

/** Hauptkategorie: erster Meal-Tag des Rezepts, sonst aus den Workout-Tags. */
export function primaryCategory(tags: string[]): string | null {
  const meal = tagsInGroup(tags, "meal")[0];
  if (meal) return meal;
  const slots = mealSlotsFromTags(tags);
  if (slots.includes("PRE_WORKOUT")) return "pre-workout";
  if (slots.includes("POST_WORKOUT")) return "post-workout";
  return null;
}

/**
 * Schwellen, gegen die die kuratierten Tags geprüft werden (Datenaudit in den
 * Tests) - "Keine falschen Tags vergeben". Bewusst einfache, dokumentierte
 * Grenzen je Portion, keine medizinische Einstufung.
 */
export const TAG_NUTRITION_RULES: Partial<Record<string, (n: NutritionPerServing) => boolean>> = {
  "high-protein": (n) => n.proteinG >= 20 || (n.kcal > 0 && (n.proteinG * 4) / n.kcal >= 0.25),
  "low-calorie": (n) => n.kcal <= 400,
  "low-carb": (n) => n.carbsG <= 25,
  keto: (n) => n.carbsG - n.fiberG <= 15 && (n.fatG * 9) / Math.max(n.kcal, 1) >= 0.5,
  "high-fiber": (n) => n.fiberG >= 7,
  "high-carb": (n) => n.carbsG >= 30 && (n.carbsG * 4) / Math.max(n.kcal, 1) >= 0.55,
};
