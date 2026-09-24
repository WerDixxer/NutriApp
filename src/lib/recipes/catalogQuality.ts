import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import { deriveDietClass } from "./diet";
import { normalizeTag } from "./tags";
import type { DietClass, RecipeUnit, StructuredIngredient } from "./types";
import { formatIngredientLine, ingredientGrams } from "./units";

/**
 * Read-only Qualitäts- und Duplikat-Analyse des Rezeptkatalogs (Kapitel 18). Grundlage für
 * spätere Import-/Review-Prozesse: erkennt, meldet, verändert nichts. Baut ausschließlich auf
 * bestehenden Bausteinen auf, keine zweite Food-Auflösung, kein zweiter Nutrition-Rechner:
 *  - Food-Identität und -Auflösung: `FoodCatalog.get` (catalog.ts), wie überall im Projekt,
 *  - Nährwert-/Mengenprüfung je Zutat: `ingredientGrams` (units.ts), dieselbe Funktion, die
 *    `computeRecipeNutrition` (nutrition.ts) intern nutzt - die Summenbildung selbst bleibt
 *    dort, hier geht es nur um die Diagnose je Zeile,
 *  - Ernährungsform: `deriveDietClass` (diet.ts), dieselbe Funktion wie beim Rezept-Build,
 *  - Tag-Normalisierung: `normalizeTag` (tags.ts), Namens-Normalisierung: `normalizeFoodLabel`
 *    (catalog.ts) - beide bereits zentral für genau diesen Zweck (Vergleichbarkeit von Text).
 */

// ---------------------------------------------------------------------------
// Eingabeform: rohe RecipeIngredient-Zeilen, bewusst INKLUSIVE ungültiger
// (fehlende/unbekannte Food-Referenz), damit der Quality-Audit sie sehen kann.
// `loadStructuredIngredients` (recipeService.ts) filtert solche Zeilen für die
// übrige App bewusst heraus; für den Audit lädt recipeService.ts sie separat.
// ---------------------------------------------------------------------------

export interface QualityIngredientRow {
  /** Roh wie in der DB, kann anders als StructuredIngredient.foodId NULL sein (fehlende Referenz). */
  foodId: string | null;
  displayName: string;
  amount: number | null;
  unit: RecipeUnit | null;
  optional: boolean;
  gramsOverride?: number;
}

export interface QualityRecipeInput {
  id: string;
  slug: string | null;
  name: string;
  servings: number;
  /** Rohe RecipeIngredient-Zeilen; leer bei Altrezepten ohne jede strukturierte Zutat. */
  structuredIngredients: QualityIngredientRow[];
  /** Recipe.ingredients (Freitext); nur als Signal für "hat überhaupt Zutatenangaben", NIE für Duplikat-Matching. */
  freeTextIngredients: string[];
  tags: string[];
}

export interface RecipeRef {
  id: string;
  slug: string | null;
  name: string;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

export interface RecipeFingerprint {
  /**
   * true = jede strukturierte Zeile hat eine im übergebenen FoodCatalog auflösbare Food-ID.
   * Nur dann ist der Fingerprint für Duplikat-Vergleiche belastbar (siehe Abschnitt 6 des
   * Auftrags: Altrezepte/unvollständige Daten nie über Textheuristiken vergleichen).
   */
  structured: boolean;
  /**
   * Kanonische, reihenfolgeunabhängige Signatur aus Food-ID + Menge + Einheit + optional +
   * Gramm-Override je Zutat, sortiert. Zwei Rezepte mit identischer Zutatenliste (in welcher
   * Reihenfolge auch immer notiert) erhalten dieselbe Signatur. Rezeptname, Slug, Tags, Meal
   * Slots und Beschreibung fließen bewusst NICHT ein: exakte Duplikate sollen sich gerade NICHT
   * daran unterscheiden, dass sie unter anderem Namen/Kategorie doppelt importiert wurden.
   * Leer, wenn `structured` false ist.
   */
  signature: string;
  /** Dieselbe Zutatenliste als lesbare Zeilen ("100 g Skyr"), sortiert - für Reports/Menschen. */
  readableIngredients: string[];
  /** Menge der distinkten Food-IDs (für die Ähnlichkeitssuche); leer, wenn nicht `structured`. */
  foodIds: Set<string>;
}

function ingredientToken(row: QualityIngredientRow): string {
  const amount = row.amount === null ? "null" : String(Math.round(row.amount * 10000) / 10000);
  const unit = row.unit ?? "null";
  const grams = row.gramsOverride === undefined ? "null" : String(row.gramsOverride);
  return `${row.foodId}|${amount}|${unit}|${row.optional}|${grams}`;
}

/**
 * Baut den Fingerprint eines Rezepts aus seinen rohen strukturierten Zeilen. Reine Funktion,
 * keine Datenbank: testbar mit Seed- oder Fixture-Daten wie jede andere Datei unter
 * `src/lib/recipes/`. Food-IDs sind die Grundlage, nicht Zutatentexte (siehe `catalog.get`).
 */
export function computeRecipeFingerprint(rows: readonly QualityIngredientRow[], catalog: FoodCatalog): RecipeFingerprint {
  if (rows.length === 0) return { structured: false, signature: "", readableIngredients: [], foodIds: new Set() };

  const foods = rows.map((row) => (row.foodId === null ? null : catalog.get(row.foodId)));
  const structured = foods.every((food) => food !== null && food !== undefined);
  if (!structured) return { structured: false, signature: "", readableIngredients: [], foodIds: new Set() };

  const signature = rows
    .map(ingredientToken)
    .sort()
    .join(";");
  const readableIngredients = rows
    .map((row, i) => formatIngredientLine({ amount: row.amount, unit: row.unit, displayName: foods[i]!.name, optional: row.optional }))
    .sort((a, b) => a.localeCompare(b, "de"));
  const foodIds = new Set(rows.map((row) => row.foodId!));

  return { structured: true, signature, readableIngredients, foodIds };
}

// ---------------------------------------------------------------------------
// Exakte Duplikate
// ---------------------------------------------------------------------------

export interface ExactDuplicateGroup {
  status: "exact";
  signature: string;
  recipes: RecipeRef[];
  /** Die gemeinsame Zutatenliste, lesbar formatiert (identisch für alle Rezepte der Gruppe). */
  sharedFeatures: string[];
}

/**
 * Gruppiert Rezepte mit identischem strukturellem Fingerprint (Abschnitt 3). Nur Rezepte mit
 * `structured: true` nehmen teil; Alt-/unvollständige Rezepte können nie als exaktes Duplikat
 * gelten, egal wie ähnlich ihr Freitext aussieht. Erkennt, verändert nichts.
 */
export function findExactRecipeDuplicates(recipes: QualityRecipeInput[], catalog: FoodCatalog): ExactDuplicateGroup[] {
  const bySignature = new Map<string, { recipe: QualityRecipeInput; fingerprint: RecipeFingerprint }[]>();

  for (const recipe of recipes) {
    const fingerprint = computeRecipeFingerprint(recipe.structuredIngredients, catalog);
    if (!fingerprint.structured) continue;
    const list = bySignature.get(fingerprint.signature) ?? [];
    list.push({ recipe, fingerprint });
    bySignature.set(fingerprint.signature, list);
  }

  const groups: ExactDuplicateGroup[] = [];
  for (const [signature, entries] of bySignature) {
    if (entries.length < 2) continue;
    groups.push({
      status: "exact",
      signature,
      recipes: entries.map((e) => ({ id: e.recipe.id, slug: e.recipe.slug, name: e.recipe.name })),
      sharedFeatures: entries[0].fingerprint.readableIngredients,
    });
  }
  // Deterministische Reihenfolge (Berichte müssen stabil sein, unabhängig von der Map-Iteration).
  return groups.sort((a, b) => a.recipes[0].name.localeCompare(b.recipes[0].name, "de"));
}

// ---------------------------------------------------------------------------
// Mögliche (Near-)Duplikate
// ---------------------------------------------------------------------------

export interface PossibleDuplicatePair {
  status: "possible";
  recipeA: RecipeRef;
  recipeB: RecipeRef;
  /** 0..1, nach Abzug etwaiger Abwertungen (siehe `dietClassDiffers`). */
  score: number;
  /** Anteil gemeinsamer Food-IDs an der Vereinigung beider Zutatenlisten (Jaccard). */
  ingredientOverlap: number;
  /** Enthaltensein der kleineren Namens-Wortmenge in der größeren, z.B. "Protein Pancakes" in "... with Berries". */
  nameOverlap: number;
  sharedFoodIds: string[];
  /** Dieselben Foods als lesbare, sortierte Namen (Kapitel 19: Review-Vergleich "Gemeinsame Ingredients"). */
  sharedFoodNames: string[];
  /**
   * true = die beiden Rezepte haben unterschiedliche Ernährungsform (vegan/vegetarisch/
   * pescetarisch/omnivore, siehe deriveDietClass). Kein Ausschlussgrund (die Erkennung bleibt
   * "möglich", siehe Auftrag Abschnitt 5: "Chicken Rice Bowl"/"Tofu Rice Bowl" *können* ähnlich
   * sein), aber ein Abwertungsgrund UND ein expliziter Hinweis für die menschliche Prüfung -
   * nie automatisch als Duplicate/Merge-Kandidat behandeln.
   */
  dietClassDiffers: boolean;
}

/** Anteil gemeinsamer Elemente an der Vereinigung. */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Anteil der kleineren Menge, der in der größeren enthalten ist (asymmetrisch, für "X" vs. "X plus Zusatz"). */
function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let common = 0;
  for (const x of small) if (big.has(x)) common++;
  return common / small.size;
}

function nameWords(name: string): Set<string> {
  return new Set(
    normalizeFoodLabel(name)
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
}

/**
 * Nur Zutaten-Overlap unter diesem Wert: kein Kandidat, unabhängig von Namensähnlichkeit
 * (Auftrag Abschnitt 4: "nicht auf einfacher Namensähnlichkeit allein basieren").
 */
const MIN_INGREDIENT_OVERLAP = 0.34;
/** Gesamtscore ab diesem Wert gilt als "possible". */
const POSSIBLE_THRESHOLD = 0.6;
/** Abwertung, wenn die Ernährungsform differiert (Abschnitt 5: kein automatisches Duplicate). */
const DIET_CLASS_PENALTY = 0.15;

interface ComparableRecipe {
  recipe: QualityRecipeInput;
  fingerprint: RecipeFingerprint;
  dietClass: DietClass;
  nameWords: Set<string>;
  tags: Set<string>;
}

function comparableRecipes(recipes: QualityRecipeInput[], catalog: FoodCatalog): ComparableRecipe[] {
  const result: ComparableRecipe[] = [];
  for (const recipe of recipes) {
    const fingerprint = computeRecipeFingerprint(recipe.structuredIngredients, catalog);
    if (!fingerprint.structured) continue;
    const structured: StructuredIngredient[] = recipe.structuredIngredients.map((row) => ({
      foodId: row.foodId!,
      displayName: row.displayName,
      amount: row.amount,
      unit: row.unit,
      optional: row.optional,
      ...(row.gramsOverride !== undefined ? { gramsOverride: row.gramsOverride } : {}),
    }));
    result.push({
      recipe,
      fingerprint,
      dietClass: deriveDietClass(structured, catalog),
      nameWords: nameWords(recipe.name),
      tags: new Set(recipe.tags.map(normalizeTag)),
    });
  }
  return result;
}

/**
 * Findet mögliche (nicht exakte) Duplikate: Kombination aus Food-ID-Overlap, Namens- und
 * Tag-Ähnlichkeit (Abschnitt 4). Nur unter Rezepten mit belastbaren strukturierten Daten -
 * Altrezepte/unvollständige Daten werden nie über Textheuristiken verglichen (Abschnitt 6).
 * Paare mit identischem Fingerprint gehören zu `findExactRecipeDuplicates`, nicht hierher.
 *
 * Performance (Abschnitt 16): paarweiser Vergleich, O(n²) über die vergleichbaren Rezepte -
 * beim aktuellen Katalogumfang (~60) unproblematisch. Bei deutlich größeren Katalogen ließe
 * sich vorab nach dominanten Food-IDs bucketn, um nur plausible Paare zu vergleichen; das ist
 * hier bewusst nicht implementiert (kein Feature über den Auftrag hinaus).
 */
export function findPossibleRecipeDuplicates(recipes: QualityRecipeInput[], catalog: FoodCatalog): PossibleDuplicatePair[] {
  const comparable = comparableRecipes(recipes, catalog);
  const pairs: PossibleDuplicatePair[] = [];

  for (let i = 0; i < comparable.length; i++) {
    for (let j = i + 1; j < comparable.length; j++) {
      const a = comparable[i];
      const b = comparable[j];
      if (a.fingerprint.signature === b.fingerprint.signature) continue; // exaktes Duplikat, nicht hier melden

      const ingredientOverlap = jaccard(a.fingerprint.foodIds, b.fingerprint.foodIds);
      if (ingredientOverlap < MIN_INGREDIENT_OVERLAP) continue;

      const nameOverlap = containment(a.nameWords, b.nameWords);
      const tagOverlap = jaccard(a.tags, b.tags);
      const dietClassDiffers = a.dietClass !== b.dietClass;

      let score = 0.6 * ingredientOverlap + 0.25 * nameOverlap + 0.15 * tagOverlap;
      if (dietClassDiffers) score -= DIET_CLASS_PENALTY;
      score = Math.max(0, Math.min(1, score));
      if (score < POSSIBLE_THRESHOLD) continue;

      const sharedFoodIds = [...a.fingerprint.foodIds].filter((id) => b.fingerprint.foodIds.has(id)).sort();
      const sharedFoodNames = sharedFoodIds.map((id) => catalog.get(id)?.name ?? id).sort((x, y) => x.localeCompare(y, "de"));
      pairs.push({
        status: "possible",
        recipeA: { id: a.recipe.id, slug: a.recipe.slug, name: a.recipe.name },
        recipeB: { id: b.recipe.id, slug: b.recipe.slug, name: b.recipe.name },
        score: Math.round(score * 1000) / 1000,
        ingredientOverlap: Math.round(ingredientOverlap * 1000) / 1000,
        nameOverlap: Math.round(nameOverlap * 1000) / 1000,
        sharedFoodIds,
        sharedFoodNames,
        dietClassDiffers,
      });
    }
  }

  return pairs.sort((x, y) => y.score - x.score || x.recipeA.name.localeCompare(y.recipeA.name, "de"));
}

// ---------------------------------------------------------------------------
// Legacy / unzureichende Daten
// ---------------------------------------------------------------------------

export interface InsufficientDataEntry {
  status: "insufficient_data";
  recipeId: string;
  recipeName: string;
  reason: string;
}

/** Rezepte, die für die Duplikat-Erkennung nicht belastbar genug sind (Abschnitt 6). */
export function findInsufficientDataRecipes(recipes: QualityRecipeInput[], catalog: FoodCatalog): InsufficientDataEntry[] {
  const entries: InsufficientDataEntry[] = [];
  for (const recipe of recipes) {
    const fingerprint = computeRecipeFingerprint(recipe.structuredIngredients, catalog);
    if (fingerprint.structured) continue;
    entries.push({
      status: "insufficient_data",
      recipeId: recipe.id,
      recipeName: recipe.name,
      reason:
        recipe.structuredIngredients.length === 0
          ? "Keine strukturierten Zutaten (Altrezept ohne RecipeIngredient-Zeilen)."
          : "Strukturierte Zutaten vorhanden, aber unvollständig (fehlende oder ungültige Food-Referenz).",
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Quality Audit
// ---------------------------------------------------------------------------

export type QualityIssueCode =
  | "missing-name"
  | "missing-slug"
  | "no-ingredient-data"
  | "no-structured-ingredients"
  | "missing-food-reference"
  | "invalid-food-reference"
  | "invalid-quantity-unit"
  | "missing-nutrition-data"
  | "duplicate-ingredient";

export type QualityIssueSeverity = "error" | "warning" | "info";

export interface RecipeQualityIssue {
  recipeId: string;
  recipeName: string;
  code: QualityIssueCode;
  severity: QualityIssueSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

function issue(
  recipe: QualityRecipeInput,
  code: QualityIssueCode,
  severity: QualityIssueSeverity,
  message: string,
  detail?: Record<string, unknown>,
): RecipeQualityIssue {
  return { recipeId: recipe.id, recipeName: recipe.name, code, severity, message, ...(detail ? { detail } : {}) };
}

function recipeLevelIssues(recipe: QualityRecipeInput): RecipeQualityIssue[] {
  const issues: RecipeQualityIssue[] = [];
  if (!recipe.name.trim()) issues.push(issue(recipe, "missing-name", "error", "Rezept hat keinen Namen."));

  const hasStructured = recipe.structuredIngredients.length > 0;
  const hasFreeText = recipe.freeTextIngredients.some((line) => line.trim() !== "");

  if (!recipe.slug) {
    issues.push(
      issue(
        recipe,
        "missing-slug",
        hasStructured ? "warning" : "info",
        hasStructured
          ? "Rezept hat strukturierte Zutaten, aber keinen Slug."
          : "Rezept hat keinen Slug (kein Katalog-Rezept, vermutlich Altbestand).",
      ),
    );
  }

  if (!hasStructured && !hasFreeText) {
    issues.push(issue(recipe, "no-ingredient-data", "error", "Rezept hat weder strukturierte noch freie Zutatenangaben."));
  } else if (!hasStructured) {
    issues.push(issue(recipe, "no-structured-ingredients", "info", "Rezept hat keine strukturierten Zutaten (Freitext/Altrezept)."));
  }

  return issues;
}

/**
 * Prüft die Zutatenzeilen eines Rezepts. Nutzt dieselben Bausteine wie `computeRecipeNutrition`
 * (`catalog.get`, `ingredientGrams`), um pro Zeile genau zu benennen, woran es hakt - anstatt
 * einen zweiten Nährwert-/Auflösungs-Mechanismus zu bauen. Die Summenbildung (kcal/Makros)
 * bleibt ausschließlich in `computeRecipeNutrition`; hier geht es nur um die Diagnose je Zeile.
 */
function ingredientLevelIssues(recipe: QualityRecipeInput, catalog: FoodCatalog): RecipeQualityIssue[] {
  const issues: RecipeQualityIssue[] = [];
  const seenFoodIds = new Map<string, number>();

  for (const row of recipe.structuredIngredients) {
    if (row.foodId === null) {
      issues.push(issue(recipe, "missing-food-reference", "error", `Zutat "${row.displayName}" hat keine Food-Referenz.`, { displayName: row.displayName }));
      continue;
    }
    seenFoodIds.set(row.foodId, (seenFoodIds.get(row.foodId) ?? 0) + 1);

    const food = catalog.get(row.foodId);
    if (!food) {
      issues.push(
        issue(recipe, "invalid-food-reference", "error", `Zutat "${row.displayName}" verweist auf ein unbekanntes Food (${row.foodId}).`, {
          foodId: row.foodId,
        }),
      );
      continue;
    }
    if (food.negligible || row.optional || row.amount === null) continue; // wie computeRecipeNutrition: legitim ausgenommen

    const grams = ingredientGrams(row, food);
    if (grams === null) {
      issues.push(
        issue(recipe, "invalid-quantity-unit", "warning", `Zutat "${row.displayName}": Menge/Einheit "${row.unit}" lässt sich nicht in Gramm umrechnen.`, {
          unit: row.unit,
        }),
      );
    } else if (!food.nutrition) {
      issues.push(issue(recipe, "missing-nutrition-data", "warning", `Food "${food.name}" hat keine Nährwertangaben.`, { foodId: food.id }));
    }
  }

  for (const [foodId, count] of seenFoodIds) {
    if (count > 1) {
      issues.push(
        issue(recipe, "duplicate-ingredient", "warning", `Food "${catalog.get(foodId)?.name ?? foodId}" kommt ${count}× im selben Rezept vor.`, {
          foodId,
          count,
        }),
      );
    }
  }

  return issues;
}

/**
 * Zentraler Quality Audit (Abschnitt 7): read-only, keine Reparatur. Deckt fehlenden Namen/Slug,
 * fehlende/unbekannte Food-Referenzen, nicht umrechenbare Mengen/Einheiten, fehlende
 * Nährwertdaten und doppelte Zutaten je Rezept ab.
 */
export function auditRecipeCatalogQuality(recipes: QualityRecipeInput[], catalog: FoodCatalog): RecipeQualityIssue[] {
  return recipes.flatMap((recipe) => [...recipeLevelIssues(recipe), ...ingredientLevelIssues(recipe, catalog)]);
}

// ---------------------------------------------------------------------------
// Zentraler Report
// ---------------------------------------------------------------------------

export interface RecipeCatalogQualityReport {
  summary: {
    totalRecipes: number;
    structuredRecipes: number;
    insufficientDataRecipes: number;
    exactDuplicateGroups: number;
    recipesInExactDuplicates: number;
    possibleDuplicatePairs: number;
    qualityIssues: number;
    qualityIssuesBySeverity: Record<QualityIssueSeverity, number>;
  };
  exactDuplicates: ExactDuplicateGroup[];
  possibleDuplicates: PossibleDuplicatePair[];
  insufficientData: InsufficientDataEntry[];
  qualityIssues: RecipeQualityIssue[];
}

/**
 * Fasst Fingerprint-Duplikate, Near-Duplikate, Altbestand und Quality Audit zu einem Bericht
 * zusammen (Abschnitt 8). Rein diagnostisch: kein Schreibzugriff, keine Löschung, kein Merge.
 */
export function buildRecipeCatalogQualityReport(recipes: QualityRecipeInput[], catalog: FoodCatalog): RecipeCatalogQualityReport {
  const exactDuplicates = findExactRecipeDuplicates(recipes, catalog);
  const possibleDuplicates = findPossibleRecipeDuplicates(recipes, catalog);
  const insufficientData = findInsufficientDataRecipes(recipes, catalog);
  const qualityIssues = auditRecipeCatalogQuality(recipes, catalog);

  const qualityIssuesBySeverity: Record<QualityIssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const q of qualityIssues) qualityIssuesBySeverity[q.severity]++;

  return {
    summary: {
      totalRecipes: recipes.length,
      structuredRecipes: recipes.length - insufficientData.length,
      insufficientDataRecipes: insufficientData.length,
      exactDuplicateGroups: exactDuplicates.length,
      recipesInExactDuplicates: exactDuplicates.reduce((sum, g) => sum + g.recipes.length, 0),
      possibleDuplicatePairs: possibleDuplicates.length,
      qualityIssues: qualityIssues.length,
      qualityIssuesBySeverity,
    },
    exactDuplicates,
    possibleDuplicates,
    insufficientData,
    qualityIssues,
  };
}
