import { matchesAllergen } from "../foodMatching";
import { RECIPE_TAG_LABELS } from "../labels";
import { dbRecipeToDetail, type DbRecipeLike } from "../recipeDetail";
import type { RecipeDetail } from "@/components/RecipeDetailModal";
import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import { filterRecipes, type FilterableRecipe, type RecipeFilter } from "./filters";
import { createFoodPreferenceContext, isDislikedHit, isLikedHit } from "./foodPreferences";
import { personalizeRecipe, toPersonalizedVariant, type PersonalizedVariant } from "./personalization";
import { suggestFoods } from "./foodSuggestions";
import { recipeType, RECIPE_TYPE_ORDER, type RecipeType } from "./recipeType";
import { normalizeTag, type MealSlotName, type SportName } from "./tags";
import type { StructuredIngredient } from "./types";

/**
 * Rezept-Katalog (Browser): Suche, Filter und Personalisierung ohne eigene
 * Matcher. Alles Wesentliche kommt aus bestehenden Bausteinen:
 *  - Filter: `filterRecipes` (recipes/filters.ts) und die Tag-Registry (tags.ts),
 *  - Zutaten-Suche: `FoodCatalog.resolveLabel` (Name/Alias) und die Präfix-Vorschläge
 *    `suggestFoods`, verglichen über die Food-ID der strukturierten Zutaten,
 *  - Allergien: `matchesAllergen` (Kapitel 13, recipes/allergens.ts),
 *  - Lieblinge/Abneigungen: `createFoodPreferenceContext` (recipes/foodPreferences.ts).
 */

/** Ein Katalog-Rezept mit den Feldern, die Suche, Filter und Karten brauchen. */
export interface BrowseRecipe extends FilterableRecipe {
  id: string;
  slug: string;
  name: string;
  description: string;
  carbsG: number;
  fatG: number;
  servings: number;
  cuisine: string | null;
  allergens: string[];
  /** Strukturierte Zutaten (RecipeIngredient); `foodId` verweist auf das zentrale Food. */
  ingredients: StructuredIngredient[];
  /** Aus den strukturierten Zutaten formatiert (recipes/units.ts:formatIngredientLine). */
  ingredientLines: string[];
}

// ---------------------------------------------------------------------------
// Suche
// ---------------------------------------------------------------------------

function wordsOf(text: string): string[] {
  return normalizeFoodLabel(text)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Wörter der Tags in kanonischer Form UND mit deutschem Anzeigenamen ("high-protein" + "Proteinreich"). */
function tagWords(tags: string[]): string[] {
  return tags.flatMap((raw) => {
    const tag = normalizeTag(raw);
    return [...wordsOf(tag), ...wordsOf(RECIPE_TAG_LABELS[tag] ?? "")];
  });
}

interface SearchIndex {
  /** Wörter des Namens: dürfen auch Wortanfang der Eingabe sein ("Pancake" -> "Pancakes"). */
  nameWords: string[];
  /** Wörter aus Beschreibung, Tags, Küche, Zutatennamen: nur ganze Wörter (kein "Reis" in "Reiswaffeln"). */
  exactWords: Set<string>;
  foodIds: Set<string>;
}

function indexOf(recipe: BrowseRecipe): SearchIndex {
  return {
    nameWords: wordsOf(recipe.name),
    exactWords: new Set([
      ...wordsOf(recipe.description),
      ...tagWords(recipe.tags),
      ...wordsOf(recipe.cuisine ?? ""),
      ...recipe.ingredients.flatMap((i) => wordsOf(i.displayName)),
    ]),
    foodIds: new Set(recipe.ingredients.map((i) => i.foodId)),
  };
}

/**
 * Zutaten, die ein Suchbegriff meint: ein Name/Alias des Katalogs trifft genau dieses
 * Food ("Reis" nur Reis, nie Reiswaffeln). Nur ein unvollständiges Wort ("Hähn", "Pas")
 * wird über die Präfix-Vorschläge auf Foods erweitert.
 */
function foodIdsForUnit(unit: string, catalog: FoodCatalog): Set<string> {
  const exact = catalog.resolveLabel(unit);
  if (exact.length > 0) return new Set(exact.map((f) => f.id));
  const prefix = suggestFoods(catalog.all(), unit, { limit: Number.MAX_SAFE_INTEGER });
  return new Set(prefix.map((s) => s.foodId));
}

/**
 * Sucht Katalog-Rezepte. Leere Suche = alle. Mehrere Wörter müssen alle passen; ergibt
 * die ganze Eingabe ein Food ("Frischkäse light"), gilt sie als ein Begriff. Reihenfolge
 * der Rezepte bleibt unverändert (kein Ranking).
 */
export function searchBrowseRecipes<T extends BrowseRecipe>(recipes: T[], query: string, catalog: FoodCatalog): T[] {
  const normalized = normalizeFoodLabel(query);
  if (!normalized) return recipes;

  const units = catalog.resolveLabel(normalized).length > 0 ? [normalized] : normalized.split(/\s+/);
  const unitFoods = units.map((unit) => foodIdsForUnit(unit, catalog));

  return recipes.filter((recipe) => {
    const index = indexOf(recipe);
    return units.every((unit, i) => {
      const unitWords = wordsOf(unit);
      const text =
        unitWords.length > 0 &&
        unitWords.every((word) => index.nameWords.some((w) => w.startsWith(word)) || index.exactWords.has(word));
      const food = [...unitFoods[i]].some((id) => index.foodIds.has(id));
      return text || food;
    });
  });
}

// ---------------------------------------------------------------------------
// Anfrage (URL) <-> Filter
// ---------------------------------------------------------------------------

export interface CatalogQuery {
  q: string;
  filter: RecipeFilter;
  /** Wegen Allergien ausgeblendete Rezepte trotzdem (markiert) anzeigen. */
  showBlocked: boolean;
}

export const MEAL_PARAMS: Record<string, MealSlotName> = {
  breakfast: "BREAKFAST",
  lunch: "LUNCH",
  dinner: "DINNER",
  snack: "SNACK",
  "pre-workout": "PRE_WORKOUT",
  "post-workout": "POST_WORKOUT",
};
export const DIET_PARAMS = ["vegetarian", "vegan", "pescatarian"] as const;
export const GOAL_PARAMS = ["high-protein", "low-calorie", "low-carb", "high-fiber"] as const;
export const SPORT_PARAMS = ["football", "strength", "cardio"] as const;
export const FLAG_PARAMS = ["quick", "meal-prep", "budget-friendly"] as const;

type Params = Record<string, string | string[] | undefined>;

function listParam(params: Params, key: string): string[] {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

function pick<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return allowed.filter((a) => values.includes(a));
}

/** Liest die URL-Parameter; unbekannte Werte werden ignoriert, nie in einen Filter übernommen. */
export function parseCatalogQuery(params: Params): CatalogQuery {
  const rawQ = params.q;
  const q = (Array.isArray(rawQ) ? rawQ[0] : rawQ) ?? "";

  const meals = pick(listParam(params, "meal"), Object.keys(MEAL_PARAMS)).map((m) => MEAL_PARAMS[m]);
  const diets = pick(listParam(params, "diet"), DIET_PARAMS);
  const goals = pick(listParam(params, "goal"), GOAL_PARAMS);
  const sports = pick(listParam(params, "sport"), SPORT_PARAMS) as SportName[];
  const flags = pick(listParam(params, "flag"), FLAG_PARAMS);

  const filter: RecipeFilter = {
    ...(meals.length ? { mealSlots: meals } : {}),
    ...(diets.length ? { diets: [...diets] } : {}),
    ...(goals.includes("high-protein") ? { highProtein: true } : {}),
    ...(goals.includes("low-calorie") ? { lowCalorie: true } : {}),
    ...(goals.includes("low-carb") ? { lowCarb: true } : {}),
    ...(goals.includes("high-fiber") ? { highFiber: true } : {}),
    ...(sports.length ? { sports } : {}),
    ...(flags.includes("quick") ? { quick: true } : {}),
    ...(flags.includes("meal-prep") ? { mealPrep: true } : {}),
    ...(flags.includes("budget-friendly") ? { budgetFriendly: true } : {}),
  };
  return { q: q.trim().slice(0, 80), filter, showBlocked: listParam(params, "blocked").includes("1") };
}

/** Gegenstück zu parseCatalogQuery: stabile, kurze Parameter (leere Werte entfallen). */
export function catalogQueryToSearchParams(query: CatalogQuery): URLSearchParams {
  const out = new URLSearchParams();
  const f = query.filter;
  if (query.q.trim()) out.set("q", query.q.trim());

  const meals = Object.entries(MEAL_PARAMS).filter(([, slot]) => f.mealSlots?.includes(slot)).map(([key]) => key);
  if (meals.length) out.set("meal", meals.join(","));
  if (f.diets?.length) out.set("diet", DIET_PARAMS.filter((d) => f.diets?.includes(d)).join(","));

  const goals = [
    f.highProtein && "high-protein",
    f.lowCalorie && "low-calorie",
    f.lowCarb && "low-carb",
    f.highFiber && "high-fiber",
  ].filter(Boolean) as string[];
  if (goals.length) out.set("goal", goals.join(","));
  if (f.sports?.length) out.set("sport", SPORT_PARAMS.filter((s) => f.sports?.includes(s)).join(","));

  const flags = [f.quick && "quick", f.mealPrep && "meal-prep", f.budgetFriendly && "budget-friendly"].filter(Boolean) as string[];
  if (flags.length) out.set("flag", flags.join(","));
  if (query.showBlocked) out.set("blocked", "1");
  return out;
}

export type FilterToggle =
  | { kind: "meal"; value: MealSlotName }
  | { kind: "diet"; value: (typeof DIET_PARAMS)[number] }
  | { kind: "goal"; value: (typeof GOAL_PARAMS)[number] }
  | { kind: "sport"; value: SportName }
  | { kind: "flag"; value: (typeof FLAG_PARAMS)[number] };

const GOAL_FIELD = { "high-protein": "highProtein", "low-calorie": "lowCalorie", "low-carb": "lowCarb", "high-fiber": "highFiber" } as const;
const FLAG_FIELD = { quick: "quick", "meal-prep": "mealPrep", "budget-friendly": "budgetFriendly" } as const;

export function isFilterActive(filter: RecipeFilter, toggle: FilterToggle): boolean {
  switch (toggle.kind) {
    case "meal":
      return filter.mealSlots?.includes(toggle.value) ?? false;
    case "diet":
      return filter.diets?.includes(toggle.value) ?? false;
    case "sport":
      return filter.sports?.includes(toggle.value) ?? false;
    case "goal":
      return filter[GOAL_FIELD[toggle.value]] === true;
    case "flag":
      return filter[FLAG_FIELD[toggle.value]] === true;
  }
}

function withoutItem<T>(list: T[] | undefined, item: T): T[] | undefined {
  const next = (list ?? []).filter((x) => x !== item);
  return next.length > 0 ? next : undefined;
}

/**
 * Schaltet eine Facette um. Filter verschiedener Gruppen sind kombinierbar (Frühstück + schnell +
 * proteinreich); mehrere Mahlzeiten/Sportarten gelten als "eine davon", die Ernährungsform ist
 * eine Einzelauswahl (vegan ersetzt vegetarisch, sonst wären beide identisch mit vegan).
 */
export function toggleFilter(query: CatalogQuery, toggle: FilterToggle): CatalogQuery {
  const filter: RecipeFilter = { ...query.filter };
  const active = isFilterActive(filter, toggle);

  switch (toggle.kind) {
    case "meal":
      filter.mealSlots = active ? withoutItem(filter.mealSlots, toggle.value) : [...(filter.mealSlots ?? []), toggle.value];
      if (!filter.mealSlots) delete filter.mealSlots;
      break;
    case "sport":
      filter.sports = active ? withoutItem(filter.sports, toggle.value) : [...(filter.sports ?? []), toggle.value];
      if (!filter.sports) delete filter.sports;
      break;
    case "diet":
      if (active) delete filter.diets;
      else filter.diets = [toggle.value];
      break;
    case "goal":
      if (active) delete filter[GOAL_FIELD[toggle.value]];
      else filter[GOAL_FIELD[toggle.value]] = true;
      break;
    case "flag":
      if (active) delete filter[FLAG_FIELD[toggle.value]];
      else filter[FLAG_FIELD[toggle.value]] = true;
      break;
  }
  return { ...query, filter };
}
/** Wie viele Facetten sind aktiv (für "Zurücksetzen")? Die Suche zählt nicht mit. */
export function activeFilterCount(filter: RecipeFilter): number {
  return (
    (filter.mealSlots?.length ?? 0) +
    (filter.diets?.length ?? 0) +
    (filter.sports?.length ?? 0) +
    [filter.highProtein, filter.lowCalorie, filter.lowCarb, filter.highFiber, filter.quick, filter.mealPrep, filter.budgetFriendly].filter(Boolean).length
  );
}

// ---------------------------------------------------------------------------
// Personalisierung
// ---------------------------------------------------------------------------

export interface BrowsePreferences {
  allergyLabels: string[];
  favoriteFoods: string[];
  dislikedFoods: string[];
}

export interface BrowseFlags {
  /** Verstößt gegen die Allergien des Profils (Kapitel-13-Auflösung). Harter Ausschluss, nie eine normale Empfehlung. */
  blockedByAllergy: boolean;
  /** Labels der unbeliebten Zutaten im Rezept. Nur Hinweis: der Katalog blendet Abneigungen nicht aus. */
  dislikes: string[];
  /** Enthält direkt ein Lieblingsfood. Nur Kennzeichnung, keine Sortierung. */
  favorite: boolean;
  /** Für das Rezept gibt es eine "Für dich angepasst"-Variante (personalization.ts); sie wird nie automatisch angewendet. */
  adaptable?: boolean;
}

export interface BrowseResult<T extends BrowseRecipe> {
  items: { recipe: T; flags: BrowseFlags; variant: PersonalizedVariant | null }[];
  /** Treffer von Suche und Filter, die gegen die Allergien verstoßen (ausgeblendet, außer `showBlocked`). */
  blockedCount: number;
  /** Alle Katalog-Rezepte, unabhängig von Suche und Filtern. */
  catalogSize: number;
}

/**
 * Suche + Filter + Personalisierung in einem Durchlauf. Allergien sind hart (werden
 * ausgeblendet, sofern nicht ausdrücklich angefordert); Abneigungen und Lieblinge sind nur
 * Kennzeichen, die Reihenfolge bleibt die des Katalogs.
 */
export function browseCatalog<T extends BrowseRecipe>(
  recipes: T[],
  query: CatalogQuery,
  preferences: BrowsePreferences,
  catalog: FoodCatalog,
): BrowseResult<T> {
  const matched = filterRecipes(searchBrowseRecipes(recipes, query.q, catalog), query.filter);
  const context = createFoodPreferenceContext(
    { favoriteFoods: preferences.favoriteFoods, dislikedFoods: preferences.dislikedFoods },
    catalog,
  );

  const all = matched.map((recipe) => {
    const match = context.matchFor({ id: recipe.id, ingredients: recipe.ingredientLines, structured: recipe.ingredients });
    // Optionale Variante: Abneigungen und Allergien über die zentrale Personalisierung (bestehende
    // IngredientAlternative-Kanten); das Original bleibt unverändert, es wird nichts gespeichert.
    const variant = toPersonalizedVariant(
      personalizeRecipe({ servings: recipe.servings, ingredients: recipe.ingredients }, context.preferences, catalog, {
        replaceDisliked: true,
        allergyLabels: preferences.allergyLabels,
      }),
    );
    const flags: BrowseFlags = {
      blockedByAllergy: matchesAllergen(recipe.allergens, preferences.allergyLabels, recipe.ingredientLines, catalog),
      dislikes: isDislikedHit(match) ? [...new Set(match.dislikeConflicts.map((c) => c.label))] : [],
      favorite: isLikedHit(match),
      adaptable: variant !== null,
    };
    return { recipe, flags, variant };
  });

  const blockedCount = all.filter((item) => item.flags.blockedByAllergy).length;
  const items = query.showBlocked ? all : all.filter((item) => !item.flags.blockedByAllergy);
  return { items, blockedCount, catalogSize: recipes.length };
}

// ---------------------------------------------------------------------------
// Karten und Detail
// ---------------------------------------------------------------------------

/**
 * Hinweis auf der Karte (genau einer, feste Zeile). Heute aus den Präferenz-Markierungen;
 * spätere Hinweise ("Für dich angepasst", "Magerquark statt Skyr") ergänzen nur eine weitere
 * `kind`-Variante, die Karte selbst bleibt gleich.
 */
export type CardHintKind = "allergy" | "adapted" | "dislike" | "favorite";

export interface CardHint {
  kind: CardHintKind;
  text: string;
}

/** Wichtigster Hinweis zuerst: Allergie vor "anpassbar" vor Abneigung vor Lieblingsessen. */
export function cardHint(flags: BrowseFlags): CardHint | null {
  if (flags.blockedByAllergy) return { kind: "allergy", text: "Enthält Allergene aus deinem Profil" };
  if (flags.adaptable) return { kind: "adapted", text: "Für dich anpassbar" };
  if (flags.dislikes.length > 0) return { kind: "dislike", text: `Enthält ${flags.dislikes.join(", ")}, das du nicht magst` };
  if (flags.favorite) return { kind: "favorite", text: "Mit einem deiner Lieblingsessen" };
  return null;
}

/** Was die Karte und der (bestehende) Rezept-Dialog brauchen; serialisierbar für den Client. */
export interface CatalogCard {
  id: string;
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  timeMin: number;
  /** Ein Typ pro Rezept: Icon und kurze Einordnung (lib/recipes/recipeType.ts). */
  type: Pick<RecipeType, "key" | "label">;
  hint: CardHint | null;
  flags: BrowseFlags;
  detail: RecipeDetail;
}

function labelOf(tag: string): string {
  return RECIPE_TAG_LABELS[tag] ?? tag;
}

/**
 * Baut Karte und Detail aus dem Katalog-Rezept. Das Detail nutzt den bestehenden
 * Mechanismus (`dbRecipeToDetail`), die Zutatenzeilen kommen aus den strukturierten
 * RecipeIngredient-Zeilen.
 */
export function buildCatalogCard(
  recipe: BrowseRecipe,
  flags: BrowseFlags,
  row: DbRecipeLike,
  variant: PersonalizedVariant | null = null,
): CatalogCard {
  const detail = dbRecipeToDetail(row, 1, {
    ingredientLines: recipe.ingredientLines,
    kcal: recipe.kcal,
    proteinG: recipe.proteinG,
    carbsG: recipe.carbsG,
    fatG: recipe.fatG,
    swaps: [],
  });
  const tagLabels = [...new Set(recipe.tags.map(normalizeTag))].filter((t) => t !== "omnivore").map(labelOf);
  const { key, label } = recipeType(recipe);

  return {
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    kcal: recipe.kcal,
    proteinG: recipe.proteinG,
    timeMin: recipe.timeMin,
    type: { key, label },
    hint: cardHint(flags),
    flags,
    detail: { ...detail, tagLabels, category: { key, label }, ...(variant ? { variant } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Entdecken: Bereiche der Standardansicht
// ---------------------------------------------------------------------------

export interface DiscoverSection {
  id: string;
  title: string;
  /** featured = "Für dich" (größer), compact = schnelle Gerichte (Zeile), standard = alles andere. */
  variant: "featured" | "standard" | "compact";
  cards: CatalogCard[];
  /** Alle passenden Rezepte hinter "Alle anzeigen" (kann größer sein als `cards`). */
  total: number;
  /** Bestehende Suche/Filter, die "Alle anzeigen" öffnet; fehlt, wenn es keinen Filter dafür gibt. */
  more?: CatalogQuery;
}

const FEATURED_LIMIT = 3;
const COMPACT_LIMIT = 4;
const STANDARD_LIMIT = 6;

const TYPE_SECTIONS: Record<(typeof RECIPE_TYPE_ORDER)[number], { title: string; slots: MealSlotName[] }> = {
  breakfast: { title: "Frühstück", slots: ["BREAKFAST"] },
  meal: { title: "Vollwertige Mahlzeiten", slots: ["LUNCH", "DINNER"] },
  snack: { title: "Snacks", slots: ["SNACK"] },
  "pre-workout": { title: "Vor dem Training", slots: ["PRE_WORKOUT"] },
  "post-workout": { title: "Nach dem Training", slots: ["POST_WORKOUT"] },
};

/**
 * Gliedert die ungefilterte Standardansicht in Bereiche. Keine eigene Empfehlungslogik, nur
 * bestehende Daten:
 *  - "Für dich": Rezepte mit einem Lieblingsfood (isLikedHit) und ohne Abneigung; fehlt ohne Lieblinge,
 *  - "Schnell gemacht": der bestehende Schnell-Filter (`filterRecipes`),
 *  - je ein Bereich pro Rezepttyp (recipeType), "Alle anzeigen" öffnet den passenden Mahlzeit-Filter.
 * Die Reihenfolge der Rezepte bleibt die des Katalogs.
 */
export function buildDiscoverSections<T extends BrowseRecipe>(
  items: { recipe: T; flags: BrowseFlags }[],
  toCard: (recipe: T, flags: BrowseFlags) => CatalogCard,
): DiscoverSection[] {
  const sections: DiscoverSection[] = [];
  const query = (filter: RecipeFilter): CatalogQuery => ({ q: "", filter, showBlocked: false });

  const forYou = items.filter((i) => i.flags.favorite && i.flags.dislikes.length === 0);
  if (forYou.length > 0) {
    sections.push({
      id: "for-you",
      title: "Für dich",
      variant: "featured",
      cards: forYou.slice(0, FEATURED_LIMIT).map((i) => toCard(i.recipe, i.flags)),
      total: forYou.length,
    });
  }

  const quickIds = new Set(filterRecipes(items.map((i) => i.recipe), { quick: true }).map((r) => r.id));
  const quick = items.filter((i) => quickIds.has(i.recipe.id));
  if (quick.length > 0) {
    sections.push({
      id: "quick",
      title: "Schnell gemacht",
      variant: "compact",
      cards: quick.slice(0, COMPACT_LIMIT).map((i) => toCard(i.recipe, i.flags)),
      total: quick.length,
      more: query({ quick: true }),
    });
  }

  for (const key of RECIPE_TYPE_ORDER) {
    const ofType = items.filter((i) => recipeType(i.recipe).key === key);
    if (ofType.length === 0) continue;
    const { title, slots } = TYPE_SECTIONS[key];
    const filter: RecipeFilter = { mealSlots: slots };
    sections.push({
      id: key,
      title,
      variant: "standard",
      cards: ofType.slice(0, STANDARD_LIMIT).map((i) => toCard(i.recipe, i.flags)),
      total: filterRecipes(items.map((i) => i.recipe), filter).length,
      more: query(filter),
    });
  }

  // Rezepte ohne erkennbaren Typ dürfen in der Standardansicht nicht verschwinden.
  const untyped = items.filter((i) => recipeType(i.recipe).key === "other");
  if (untyped.length > 0) {
    sections.push({
      id: "other",
      title: "Weitere Rezepte",
      variant: "standard",
      cards: untyped.slice(0, STANDARD_LIMIT).map((i) => toCard(i.recipe, i.flags)),
      total: untyped.length,
    });
  }

  return sections;
}