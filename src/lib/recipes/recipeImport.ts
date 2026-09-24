import { resolveUniqueFood } from "../pantry/pantryFoods";
import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import {
  auditRecipeCatalogQuality,
  findExactRecipeDuplicates,
  findPossibleRecipeDuplicates,
  type ExactDuplicateGroup,
  type PossibleDuplicatePair,
  type QualityIngredientRow,
  type QualityRecipeInput,
  type RecipeQualityIssue,
} from "./catalogQuality";
import { deriveAllergens, deriveDietClass } from "./diet";
import { computeRecipeNutrition, type NutritionResult } from "./nutrition";
import { exactCandidatesFor, possibleCandidatesFor, reviewReasonFor, type RecipeReviewItem, type ReviewCategory } from "./recipeReview";
import type { DietClass, RecipeUnit, StructuredIngredient } from "./types";
import { formatIngredientLine } from "./units";

/**
 * Fundament für externe Recipe-Imports (Kapitel 20): Raw Import -> Normalization -> Food
 * Resolution -> Validation -> Duplicate Detection -> Review. Noch keine echte externe Quelle,
 * noch keine Persistenz, noch keine automatische Aufnahme in den Catalog - siehe
 * `runImportPipeline` und dessen Rückgabe-Status.
 *
 * Wiederverwendete Bausteine, bewusst NICHT parallel nachgebaut:
 *  - Food-Auflösung: `resolveUniqueFood` (pantry/pantryFoods.ts) - dieselbe "eindeutig oder gar
 *    nicht"-Logik wie beim Pantry-Food-Abgleich (Kapitel 14), hier zum zweiten Mal genutzt statt
 *    ein drittes Mal nachgebaut.
 *  - Nährwerte: `computeRecipeNutrition` (nutrition.ts) - unverändert, nur mit den aufgelösten
 *    Zutaten des Imports gefüttert.
 *  - Allergene/Ernährungsform: `deriveAllergens`/`deriveDietClass` (diet.ts).
 *  - Duplikat-/Quality-Erkennung: `findExactRecipeDuplicates`, `findPossibleRecipeDuplicates`,
 *    `auditRecipeCatalogQuality` (catalogQuality.ts, Kapitel 18) - ein Import-Kandidat wird dafür
 *    lediglich in dieselbe `QualityRecipeInput`-Form gebracht wie ein echtes Katalog-Rezept
 *    (`toQualityRecipeInput`); es gibt keine zweite Duplicate-/Quality-Engine.
 *  - Review-Darstellung: `exactCandidatesFor`/`possibleCandidatesFor`/`reviewReasonFor`
 *    (recipeReview.ts, Kapitel 19) - dieselben Bausteine, die die echte Review-Queue nutzt.
 */

// ---------------------------------------------------------------------------
// 1. Raw Import: was die externe Quelle liefert, unverändert (Abschnitt 2/3)
// ---------------------------------------------------------------------------

export type ImportSourceType = "mock" | "manual" | "external_api" | "social_media";

export interface ImportSource {
  type: ImportSourceType;
  /** Menschlich lesbarer Name der Quelle, z.B. "Mock Recipe Feed", "Manuelle Eingabe". */
  label: string;
  /** ID des Rezepts BEI der Quelle, falls vorhanden (Social-Media-Post-ID, API-Rezept-ID, ...). */
  externalId?: string;
  /** URL zum Original, falls vorhanden. */
  url?: string;
}

/** Eine einzelne Zutatenzeile, exakt wie die externe Quelle sie geliefert hat. */
export interface RawImportedIngredient {
  /** Die volle Rohzeile, z.B. "2 cups Greek yogurt". Bleibt IMMER erhalten (Abschnitt 3). */
  originalText: string;
  /**
   * Falls die Quelle Menge/Einheit/Bezeichnung bereits getrennt liefert (z.B. eine strukturierte
   * API statt einer reinen Textzeile). Gesetzt hat das Vorrang vor dem Parsen von `originalText` -
   * eine strukturierte Quelle weiß es besser als unser Text-Parser.
   */
  amountHint?: number | null;
  unitHint?: string | null;
  labelHint?: string | null;
}

/** Was eine externe Quelle für ein Rezept liefert - roh, unverändert, vor jeder Interpretation. */
export interface RawImportedRecipe {
  source: ImportSource;
  name: string;
  description?: string;
  ingredients: RawImportedIngredient[];
  instructions?: string[];
  prepTimeMin?: number | null;
  servings?: number | null;
  tags?: string[];
  /** Bildreferenz (URL/ID), falls vorhanden - wird nicht heruntergeladen oder verarbeitet. */
  imageRef?: string | null;
  /** Zeitpunkt des Imports (nicht der Veröffentlichung bei der Quelle). */
  importedAt: Date;
  /** Die vollständigen Rohdaten der Quelle, unverändert aufbewahrt (z.B. das komplette API-JSON). */
  rawSourceMetadata?: unknown;
}

/** Eine (noch nicht angebundene) externe Quelle: liefert `RawImportedRecipe`, sonst nichts. */
export interface ExternalRecipeSource {
  label: string;
  fetchRecipes(): RawImportedRecipe[] | Promise<RawImportedRecipe[]>;
}

/**
 * Offline/deterministische Test-Quelle (Abschnitt 14): liefert vorbereitete `RawImportedRecipe`s,
 * genau wie eine spätere echte Quelle es täte - kein Netzwerk, kein Scraping, keine externe API.
 */
export function createMockExternalRecipeSource(label: string, recipes: RawImportedRecipe[]): ExternalRecipeSource {
  return { label, fetchRecipes: () => recipes };
}

// ---------------------------------------------------------------------------
// 2. Normalization: Rohtext -> Menge/Einheit/Bezeichnung, ohne zu raten (Abschnitt 6/16)
// ---------------------------------------------------------------------------

/**
 * Nur Einheiten, die das restliche Rezept-System auch kennt (RECIPE_UNITS, types.ts) - plus
 * kg/l, die verlustfrei in g/ml umgerechnet werden (reine SI-Umrechnung, 1 kg IST 1000 g, keine
 * Food-Annahme). "cup"/"oz"/... bleiben absichtlich unbekannt: eine Tasse wiegt je nach Zutat
 * unterschiedlich viel - das zu erfinden wäre genau die verbotene Schätzung (Abschnitt 16).
 */
const IMPORT_UNIT_ALIASES: Record<string, { unit: RecipeUnit; factor: number }> = {
  g: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  gramm: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kilogram: { unit: "g", factor: 1000 },
  kilogramm: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  milliliter: { unit: "ml", factor: 1 },
  millilitre: { unit: "ml", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  tl: { unit: "tl", factor: 1 },
  tsp: { unit: "tl", factor: 1 },
  teaspoon: { unit: "tl", factor: 1 },
  teaspoons: { unit: "tl", factor: 1 },
  teelöffel: { unit: "tl", factor: 1 },
  el: { unit: "el", factor: 1 },
  tbsp: { unit: "el", factor: 1 },
  tablespoon: { unit: "el", factor: 1 },
  tablespoons: { unit: "el", factor: 1 },
  esslöffel: { unit: "el", factor: 1 },
  piece: { unit: "piece", factor: 1 },
  pieces: { unit: "piece", factor: 1 },
  stück: { unit: "piece", factor: 1 },
  stk: { unit: "piece", factor: 1 },
  slice: { unit: "slice", factor: 1 },
  slices: { unit: "slice", factor: 1 },
  scheibe: { unit: "slice", factor: 1 },
  scheiben: { unit: "slice", factor: 1 },
  can: { unit: "can", factor: 1 },
  cans: { unit: "can", factor: 1 },
  dose: { unit: "can", factor: 1 },
  dosen: { unit: "can", factor: 1 },
  pinch: { unit: "pinch", factor: 1 },
  pinches: { unit: "pinch", factor: 1 },
  prise: { unit: "pinch", factor: 1 },
  prisen: { unit: "pinch", factor: 1 },
};

function lookupUnit(word: string | null | undefined): { unit: RecipeUnit; factor: number } | null {
  if (!word) return null;
  return IMPORT_UNIT_ALIASES[word.trim().toLowerCase()] ?? null;
}

/** Zahl + Worteinheit + Rest, z.B. "100 g Greek Yogurt" oder "2 tbsp honey". */
const AMOUNT_UNIT_LABEL = /^(\d+(?:[.,]\d+)?)\s*([a-zA-Zäöüßé]+)\.?\s+(.+)$/;
/** Nur Zahl + Rest, ohne erkennbares Einheitswort, z.B. "1 banana". */
const AMOUNT_LABEL = /^(\d+(?:[.,]\d+)?)\s+(.+)$/;

export interface ParsedIngredientText {
  amount: number | null;
  unit: RecipeUnit | null;
  label: string;
}

/**
 * Zerlegt eine rohe Zutatenzeile in Menge/Einheit/Bezeichnung. Erkennt NUR, was eindeutig ist:
 * ein unbekanntes Einheitswort ("cups", "oz", ...) wird NICHT geraten - die Menge bleibt bekannt,
 * aber `unit` bleibt `null` und das Wort landet unverändert im Label, statt verloren zu gehen
 * (Abschnitt 3/16: "keine Halluzination", Rohinformation bleibt sichtbar).
 *
 * Kein Duplikat von `mealPrep/ingredientParser.ts:parseIngredientLine` (dieselbe Vorsicht, aber
 * anderes Ziel-Einheiten-Vokabular: `PantryUnit` dort kennt weder TL/EL/Scheibe/Dose/Prise noch
 * englische Wörter, die in importierten Rezepttexten üblich sind - eine Wiederverwendung hätte
 * die häufigsten Recipe-Einheiten silently verworfen statt sie zu erkennen).
 */
export function parseRawIngredientText(text: string): ParsedIngredientText {
  const trimmed = text.trim();

  const withUnit = trimmed.match(AMOUNT_UNIT_LABEL);
  if (withUnit) {
    const [, amountStr, unitWord, restOfLabel] = withUnit;
    const amount = Number(amountStr.replace(",", "."));
    if (Number.isFinite(amount) && amount > 0) {
      const alias = lookupUnit(unitWord);
      if (alias) {
        return { amount: Math.round(amount * alias.factor * 1000) / 1000, unit: alias.unit, label: restOfLabel.trim() };
      }
      // Menge bekannt, Einheitswort nicht auflösbar (z.B. "cups", oder ein Adjektiv wie "large"
      // vor "eggs") - wir raten die Einheit nicht, das Wort bleibt Teil des Labels.
      return { amount, unit: null, label: `${unitWord} ${restOfLabel}`.trim() };
    }
  }

  // Kein Einheitswort erkennbar: "1 banana" gilt als 1 Stück - die übliche Lesart eines bloßen
  // Zählers vor einem Substantiv in Rezepttexten, keine Schätzung einer unbekannten Einheit.
  const withoutUnit = trimmed.match(AMOUNT_LABEL);
  if (withoutUnit) {
    const [, amountStr, label] = withoutUnit;
    const amount = Number(amountStr.replace(",", "."));
    if (Number.isFinite(amount) && amount > 0) return { amount, unit: "piece", label: label.trim() };
  }

  return { amount: null, unit: null, label: trimmed };
}

// ---------------------------------------------------------------------------
// 3. Food Resolution: ausschließlich über den bestehenden FoodCatalog (Abschnitt 4/5)
// ---------------------------------------------------------------------------

export type IngredientResolutionStatus = "resolved" | "unresolved";

export interface NormalizedImportedIngredient {
  /** Rohtext, unverändert - geht nie verloren (Abschnitt 3). */
  originalText: string;
  /** normalizeFoodLabel(label) - dieselbe Normalisierung wie überall im Food-Katalog. */
  normalizedLabel: string;
  amount: number | null;
  unit: RecipeUnit | null;
  optional: boolean;
  resolutionStatus: IngredientResolutionStatus;
  /** Nur gesetzt bei resolutionStatus "resolved". */
  resolvedFoodId: string | null;
  resolvedFoodName: string | null;
}

const OPTIONAL_MARKER = /\boptional\b/i;

/**
 * Normalisiert EINE rohe Zutatenzeile: parst Menge/Einheit (sofern kein Hint vorhanden) und löst
 * das Food ausschließlich über die bestehende Katalog-Auflösung auf (`resolveUniqueFood`, Alias-
 * Auflösung inklusive). Ein mehrdeutiger oder unbekannter Treffer bleibt `unresolved` - es wird
 * nie geraten, kein Food wird dabei angelegt.
 */
export function normalizeImportedIngredient(raw: RawImportedIngredient, catalog: FoodCatalog): NormalizedImportedIngredient {
  const hasLabelHint = raw.labelHint != null && raw.labelHint.trim() !== "";
  let amount: number | null;
  let unit: RecipeUnit | null;
  let label: string;

  if (hasLabelHint) {
    label = raw.labelHint!.trim();
    if (raw.amountHint != null) {
      const alias = lookupUnit(raw.unitHint);
      amount = alias ? Math.round(raw.amountHint * alias.factor * 1000) / 1000 : raw.amountHint;
      unit = alias ? alias.unit : raw.unitHint ? null : "piece";
    } else {
      amount = null;
      unit = null;
    }
  } else {
    const parsed = parseRawIngredientText(raw.originalText);
    amount = parsed.amount;
    unit = parsed.unit;
    label = parsed.label;
  }

  const food = resolveUniqueFood(label, catalog);

  return {
    originalText: raw.originalText,
    normalizedLabel: normalizeFoodLabel(label),
    amount,
    unit,
    optional: OPTIONAL_MARKER.test(raw.originalText),
    resolutionStatus: food ? "resolved" : "unresolved",
    resolvedFoodId: food?.id ?? null,
    resolvedFoodName: food?.name ?? null,
  };
}

/** Lesbare Zeile der normalisierten Zutat, z.B. "100 g Skyr" - reine Formatierung, keine neue Logik. */
export function formatNormalizedIngredient(ingredient: NormalizedImportedIngredient): string {
  return formatIngredientLine({
    amount: ingredient.amount,
    unit: ingredient.unit,
    displayName: ingredient.resolvedFoodName ?? ingredient.normalizedLabel,
    optional: ingredient.optional,
  });
}

// ---------------------------------------------------------------------------
// 4. Imported Recipe Candidate: die normalisierte, noch nicht freigegebene Struktur
// ---------------------------------------------------------------------------

export interface ImportedRecipeCandidate {
  source: ImportSource;
  name: string;
  description: string;
  ingredients: NormalizedImportedIngredient[];
  instructions: string[];
  prepTimeMin: number | null;
  servings: number;
  tags: string[];
  imageRef: string | null;
  importedAt: Date;
  /** Vollständige Rohdaten der Quelle, unverändert (Abschnitt 2/3). */
  rawSourceMetadata: unknown;
  /** Jede Zutatenzeile im Originalwortlaut, zusätzlich gesammelt (für Freitext-Kontext/Anzeige). */
  rawIngredientLines: string[];
}

/** Normalisierungsstufe der Pipeline: aus `RawImportedRecipe` wird ein `ImportedRecipeCandidate`. */
export function normalizeImportedRecipe(raw: RawImportedRecipe, catalog: FoodCatalog): ImportedRecipeCandidate {
  return {
    source: raw.source,
    name: raw.name.trim(),
    description: raw.description?.trim() ?? "",
    ingredients: raw.ingredients.map((ingredient) => normalizeImportedIngredient(ingredient, catalog)),
    instructions: raw.instructions ?? [],
    prepTimeMin: raw.prepTimeMin ?? null,
    servings: raw.servings && raw.servings > 0 ? raw.servings : 1,
    tags: raw.tags ?? [],
    imageRef: raw.imageRef ?? null,
    importedAt: raw.importedAt,
    rawSourceMetadata: raw.rawSourceMetadata,
    rawIngredientLines: raw.ingredients.map((ingredient) => ingredient.originalText),
  };
}

function resolvedStructuredIngredients(candidate: ImportedRecipeCandidate): StructuredIngredient[] {
  return candidate.ingredients
    .filter((ingredient) => ingredient.resolvedFoodId !== null)
    .map((ingredient) => ({
      foodId: ingredient.resolvedFoodId!,
      displayName: ingredient.resolvedFoodName ?? ingredient.normalizedLabel,
      amount: ingredient.amount,
      unit: ingredient.unit,
      optional: ingredient.optional,
    }));
}

// ---------------------------------------------------------------------------
// 5. Nutrition: bestehende Utility, keine zweite Berechnung (Abschnitt 7)
// ---------------------------------------------------------------------------

export interface ImportedRecipeNutrition {
  /** Unverändertes Ergebnis von `computeRecipeNutrition` - inklusive dessen eigener `unresolved`/`complete`-Diagnose. */
  nutrition: NutritionResult;
  /** Zutaten, deren Food nicht aufgelöst werden konnte, fließen NIE in die Berechnung ein. */
  unresolvedIngredientCount: number;
}

export function computeImportedRecipeNutrition(candidate: ImportedRecipeCandidate, catalog: FoodCatalog): ImportedRecipeNutrition {
  return {
    nutrition: computeRecipeNutrition(resolvedStructuredIngredients(candidate), candidate.servings, catalog),
    unresolvedIngredientCount: candidate.ingredients.filter((i) => i.resolutionStatus === "unresolved").length,
  };
}

/**
 * Allergene/Ernährungsform NUR aus tatsächlich aufgelösten Zutaten (Abschnitt 16: "Allergene aus
 * nicht vorhandenen Daten ableiten" und "Diet Classes blind festlegen" sind verboten). Ist auch
 * nur EINE Zutat unresolved, bleibt `dietClass` bewusst `null` - ein unbekanntes Food könnte jede
 * Ernährungsform verletzen, das darf nicht verschwiegen werden. `allergensComplete` macht explizit
 * sichtbar, dass die Allergenliste in diesem Fall nicht vollständig sein kann.
 */
export interface ImportedRecipeProfile {
  allergens: string[];
  allergensComplete: boolean;
  dietClass: DietClass | null;
}

export function deriveImportedRecipeProfile(candidate: ImportedRecipeCandidate, catalog: FoodCatalog): ImportedRecipeProfile {
  const allResolved = candidate.ingredients.every((i) => i.resolutionStatus === "resolved");
  const structured = resolvedStructuredIngredients(candidate);
  return {
    allergens: deriveAllergens(structured, catalog),
    allergensComplete: allResolved,
    dietClass: allResolved ? deriveDietClass(structured, catalog) : null,
  };
}

// ---------------------------------------------------------------------------
// 6. Validation (Abschnitt 8)
// ---------------------------------------------------------------------------

export type ImportValidationCode =
  | "missing-name"
  | "no-ingredients"
  | "unresolved-food"
  | "missing-nutrition"
  | "invalid-amount-or-unit"
  | "missing-source-identifier";

export type ImportValidationSeverity = "error" | "warning";

export interface ImportValidationIssue {
  code: ImportValidationCode;
  severity: ImportValidationSeverity;
  message: string;
  /** Betroffene Zutat (Originaltext), falls zutatenbezogen. */
  ingredient?: string;
}

/**
 * Prüft einen normalisierten Kandidaten. NUR fehlender Name und komplett fehlende Zutaten sind
 * `error` (blockieren die Pipeline, siehe `runImportPipeline` -> "validation_failed"): alles
 * andere (unresolved Food, fehlende Nutrition, nicht erkannte Menge/Einheit, fehlende
 * Quellenkennung) ist `warning` - sichtbar für den Review, aber kein Show-Stopper. Eine einzelne
 * unbekannte Zutat soll ein sonst gutes Rezept nicht automatisch verwerfen.
 */
export function validateImportCandidate(candidate: ImportedRecipeCandidate, catalog: FoodCatalog): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];

  if (!candidate.name.trim()) {
    issues.push({ code: "missing-name", severity: "error", message: "Importiertes Rezept hat keinen Namen." });
  }
  if (candidate.ingredients.length === 0) {
    issues.push({ code: "no-ingredients", severity: "error", message: "Importiertes Rezept enthält keine Zutatenzeilen." });
  }
  if (!candidate.source.externalId && !candidate.source.url) {
    issues.push({
      code: "missing-source-identifier",
      severity: "warning",
      message: "Weder externe ID noch URL vorhanden - die Herkunft lässt sich später schwer nachvollziehen.",
    });
  }

  for (const ingredient of candidate.ingredients) {
    if (ingredient.resolutionStatus === "unresolved") {
      issues.push({
        code: "unresolved-food",
        severity: "warning",
        message: `Zutat "${ingredient.originalText}" konnte keinem bekannten Food zugeordnet werden.`,
        ingredient: ingredient.originalText,
      });
      continue; // Menge/Nutrition eines unbekannten Foods lässt sich ohnehin nicht bewerten.
    }
    if (ingredient.amount === null || ingredient.unit === null) {
      issues.push({
        code: "invalid-amount-or-unit",
        severity: "warning",
        message: `Zutat "${ingredient.originalText}": Menge oder Einheit nicht sicher erkannt.`,
        ingredient: ingredient.originalText,
      });
      continue;
    }
    const food = catalog.get(ingredient.resolvedFoodId!);
    if (food && !food.negligible && !food.nutrition) {
      issues.push({
        code: "missing-nutrition",
        severity: "warning",
        message: `Food "${food.name}" hat keine Nährwertangaben.`,
        ingredient: ingredient.originalText,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 7. Duplicate/Quality gegen den bestehenden Catalog (Abschnitt 9/10) - Kapitel-18-Logik
//    unverändert wiederverwendet, nur die Eingabeform angepasst.
// ---------------------------------------------------------------------------

const IMPORT_ID_PREFIX = "import:";

/** Deterministische, mit echten Katalog-IDs nie kollidierende ID für einen Import-Kandidaten. */
export function importCandidateId(candidate: ImportedRecipeCandidate): string {
  const external = candidate.source.externalId ?? candidate.source.url ?? candidate.name;
  return `${IMPORT_ID_PREFIX}${candidate.source.type}:${external}`;
}

/**
 * Bringt den Kandidaten in die Form, die Kapitel 18 versteht (`QualityRecipeInput`) - dieselbe
 * Form, die auch echte DB-Rezepte für `findExactRecipeDuplicates`/`findPossibleRecipeDuplicates`/
 * `auditRecipeCatalogQuality` nutzen. `slug: null`, weil ein Import nie ein Katalog-Rezept ist,
 * solange es nicht freigegeben wurde.
 */
export function toQualityRecipeInput(candidate: ImportedRecipeCandidate): QualityRecipeInput {
  const structuredIngredients: QualityIngredientRow[] = candidate.ingredients.map((ingredient) => ({
    foodId: ingredient.resolvedFoodId,
    displayName: ingredient.resolvedFoodName ?? ingredient.normalizedLabel,
    amount: ingredient.amount,
    unit: ingredient.unit,
    optional: ingredient.optional,
  }));

  return {
    id: importCandidateId(candidate),
    slug: null,
    name: candidate.name,
    servings: candidate.servings,
    structuredIngredients,
    freeTextIngredients: candidate.rawIngredientLines,
    tags: candidate.tags,
  };
}

export interface ImportDuplicateCheck {
  /** Gefiltert auf Gruppen/Paare, die den Kandidaten tatsächlich betreffen. */
  exactDuplicates: ExactDuplicateGroup[];
  possibleDuplicates: PossibleDuplicatePair[];
}

/**
 * Prüft den Kandidaten gegen den bestehenden Catalog (Abschnitt 10). `existingCatalogRecipes` ist
 * die normale Kapitel-18-Eingabe (`loadCatalogQualityInputs()`); hier wird NUR der Kandidat
 * angehängt, dieselben Funktionen wie überall sonst laufen unverändert darüber. Kein zweiter
 * Duplicate-Scan, keine automatische Entscheidung - nur "needs review" oder nicht.
 */
export function checkImportCandidateAgainstCatalog(
  candidate: ImportedRecipeCandidate,
  existingCatalogRecipes: readonly QualityRecipeInput[],
  catalog: FoodCatalog,
): ImportDuplicateCheck {
  const candidateInput = toQualityRecipeInput(candidate);
  const comparisonSet = [...existingCatalogRecipes, candidateInput];

  return {
    exactDuplicates: findExactRecipeDuplicates(comparisonSet, catalog).filter((group) => group.recipes.some((r) => r.id === candidateInput.id)),
    possibleDuplicates: findPossibleRecipeDuplicates(comparisonSet, catalog).filter(
      (pair) => pair.recipeA.id === candidateInput.id || pair.recipeB.id === candidateInput.id,
    ),
  };
}

// ---------------------------------------------------------------------------
// 8. Statusmodell (Abschnitt 11) - reiner Laufzeit-Status, keine Persistenz
// ---------------------------------------------------------------------------

/**
 * `approved`/`rejected` werden NIE von `runImportPipeline` gesetzt - das ist eine spätere
 * menschliche Entscheidung (genau wie `ReviewStatus` in recipeReview.ts, Kapitel 19). Die
 * Pipeline selbst kennt nur die ersten fünf Werte.
 */
export const IMPORT_STATUSES = ["raw", "normalized", "validation_failed", "ready_for_review", "duplicate_review", "approved", "rejected"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// ---------------------------------------------------------------------------
// 9. Pipeline: verbindet alle Stufen, ohne den Catalog jemals zu schreiben (Abschnitt 13)
// ---------------------------------------------------------------------------

export interface ImportCandidateEvaluation {
  candidate: ImportedRecipeCandidate;
  nutrition: ImportedRecipeNutrition;
  profile: ImportedRecipeProfile;
  validationIssues: ImportValidationIssue[];
  /** Aus Kapitel 18 unverändert wiederverwendet, nur auf den Kandidaten selbst berechnet. */
  catalogQualityIssues: RecipeQualityIssue[];
  duplicates: ImportDuplicateCheck;
  status: Extract<ImportStatus, "validation_failed" | "ready_for_review" | "duplicate_review">;
}

export interface ImportPipelineResult extends ImportCandidateEvaluation {
  /** Jeder Status, den der Kandidat durchlaufen hat, in Reihenfolge - macht die Pipeline nachvollziehbar. */
  statusHistory: ImportStatus[];
}

/**
 * Bewertet einen bereits normalisierten Kandidaten: Nährwerte/Profil, Validierung und - bei
 * bestandener Validierung - Duplicate-/Quality-Check gegen den bestehenden Catalog. Getrennt von
 * `runImportPipeline`, weil Kapitel 21 gespeicherte Kandidaten bewertet, deren Zutaten nach dem
 * Import manuell einem Food zugeordnet sein können; ein erneutes Normalisieren des Rohtexts würde
 * diese Zuordnung verwerfen. Schreibt nichts.
 */
export function evaluateImportCandidate(
  candidate: ImportedRecipeCandidate,
  catalog: FoodCatalog,
  existingCatalogRecipes: readonly QualityRecipeInput[],
): ImportCandidateEvaluation {
  const nutrition = computeImportedRecipeNutrition(candidate, catalog);
  const profile = deriveImportedRecipeProfile(candidate, catalog);
  const validationIssues = validateImportCandidate(candidate, catalog);

  if (validationIssues.some((issue) => issue.severity === "error")) {
    return {
      candidate,
      nutrition,
      profile,
      validationIssues,
      catalogQualityIssues: [],
      duplicates: { exactDuplicates: [], possibleDuplicates: [] },
      status: "validation_failed",
    };
  }

  const duplicates = checkImportCandidateAgainstCatalog(candidate, existingCatalogRecipes, catalog);
  const catalogQualityIssues = auditRecipeCatalogQuality([toQualityRecipeInput(candidate)], catalog);
  const status = duplicates.exactDuplicates.length > 0 || duplicates.possibleDuplicates.length > 0 ? "duplicate_review" : "ready_for_review";

  return { candidate, nutrition, profile, validationIssues, catalogQualityIssues, duplicates, status };
}

/**
 * Die vollständige Pipeline für EINEN rohen Import: normalisieren, dann `evaluateImportCandidate`.
 * Schreibt NIE in die Datenbank, legt NIE ein Food/Recipe an - das Ergebnis ist ausschließlich
 * eine Laufzeit-Struktur für den Review (Abschnitt 12/13/24).
 */
export function runImportPipeline(
  raw: RawImportedRecipe,
  catalog: FoodCatalog,
  existingCatalogRecipes: readonly QualityRecipeInput[],
): ImportPipelineResult {
  const candidate = normalizeImportedRecipe(raw, catalog);
  const evaluation = evaluateImportCandidate(candidate, catalog, existingCatalogRecipes);
  return { ...evaluation, statusHistory: ["raw", "normalized", evaluation.status] };
}

// ---------------------------------------------------------------------------
// 10. Review-Integration (Abschnitt 12) - dieselben Typen/Bausteine wie die echte Review-Queue
// ---------------------------------------------------------------------------

function summarizeValidationErrors(issues: readonly ImportValidationIssue[]): string {
  const errors = issues.filter((issue) => issue.severity === "error");
  return errors.length > 0 ? errors.map((issue) => issue.message).join(" ") : "Validierung fehlgeschlagen.";
}

/**
 * Wandelt ein Pipeline-Ergebnis in ein `RecipeReviewItem` (recipeReview.ts) um - dieselbe Struktur,
 * die die echte `/internal/recipe-review`-Queue für DB-Rezepte verwendet. Kein separates zweites
 * Review-Modell: ein Import-Kandidat kann in genau derselben UI dargestellt werden.
 */
export function toRecipeReviewItem(result: ImportCandidateEvaluation): RecipeReviewItem {
  const candidateInput = toQualityRecipeInput(result.candidate);
  const exact = exactCandidatesFor(candidateInput.id, result.duplicates.exactDuplicates);
  const possible = possibleCandidatesFor(candidateInput.id, result.duplicates.possibleDuplicates);
  const duplicateCandidates = [...exact, ...possible];
  const insufficientDataReason = result.status === "validation_failed" ? summarizeValidationErrors(result.validationIssues) : null;

  const category: ReviewCategory =
    exact.length > 0
      ? "duplicate_exact"
      : possible.length > 0
        ? "duplicate_possible"
        : insufficientDataReason !== null
          ? "insufficient_data"
          : result.catalogQualityIssues.length > 0
            ? "quality_issue"
            : "clean";

  return {
    recipeId: candidateInput.id,
    recipeName: result.candidate.name.trim() || "(kein Name)",
    slug: null,
    status: "pending",
    category,
    reviewReason: reviewReasonFor(category, duplicateCandidates, result.catalogQualityIssues, insufficientDataReason),
    qualityIssues: result.catalogQualityIssues,
    duplicateCandidates,
    insufficientDataReason,
  };
}
