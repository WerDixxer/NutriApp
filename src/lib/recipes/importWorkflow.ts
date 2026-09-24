import type { FoodCatalog } from "./catalog";
import { normalizeFoodLabel } from "./catalog";
import type { QualityIssueCode } from "./catalogQuality";
import type { IngredientSeed, RecipeSeed } from "./data/recipes";
import { roundNutrition } from "./nutrition";
import type { ImportCandidateEvaluation, ImportedRecipeCandidate, NormalizedImportedIngredient } from "./recipeImport";
import { mealSlotsFromTags, normalizeTag, TAG_NUTRITION_RULES, tagGroup, TAG_GROUPS } from "./tags";
import type { DietClass, NutritionPerServing } from "./types";

/**
 * Reine Regeln der persistenten Import-Queue (Kapitel 21): Statusmodell, erlaubte Übergänge,
 * Freigabe-Voraussetzungen und die Ableitung dessen, was beim Publish in den Katalog geschrieben
 * würde. Keine Datenbank, keine Seiteneffekte - die Persistenz liegt in importQueueService.ts.
 */

// ---------------------------------------------------------------------------
// Statusmodell
// ---------------------------------------------------------------------------

export const IMPORT_QUEUE_STATUSES = ["pending_review", "needs_changes", "approved", "rejected", "published", "failed"] as const;
export type ImportQueueStatus = (typeof IMPORT_QUEUE_STATUSES)[number];

export function isImportQueueStatus(value: string): value is ImportQueueStatus {
  return (IMPORT_QUEUE_STATUSES as readonly string[]).includes(value);
}

/**
 * Einzige Quelle der erlaubten Übergänge. `published` und `failed` erreicht ein Kandidat nur über
 * die Publish-Aktion: `published` nach erfolgreicher Katalog-Erstellung, `failed`, wenn die
 * erneute Prüfung unmittelbar vor dem Publish die Freigabe nicht mehr trägt (z.B. inzwischen ein
 * exaktes Duplikat im Katalog). Technische Fehler ändern den Status nicht (Rollback, erneut
 * versuchbar). `rejected` und `published` sind endgültig.
 */
const ALLOWED_TRANSITIONS: Record<ImportQueueStatus, readonly ImportQueueStatus[]> = {
  pending_review: ["needs_changes", "rejected", "approved"],
  needs_changes: ["pending_review", "rejected"],
  approved: ["published", "failed"],
  failed: ["needs_changes", "rejected"],
  rejected: [],
  published: [],
};

export function canTransition(from: ImportQueueStatus, to: ImportQueueStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Nur in diesen Status darf ein Reviewer unaufgelöste Zutaten einem Food zuordnen. */
export const FOOD_ASSIGNMENT_STATUSES: readonly ImportQueueStatus[] = ["pending_review", "needs_changes"];

// ---------------------------------------------------------------------------
// Gespeicherte Zutat
// ---------------------------------------------------------------------------

/**
 * Normalisierte Zutat, wie sie in `RecipeImportCandidate.ingredients` liegt. `manualAssignment`
 * dokumentiert eine Zuordnung durch einen Reviewer; bei automatischer Auflösung (Kapitel 20) oder
 * unaufgelösten Zutaten ist es `null`. Originaltext und normalisiertes Label bleiben unverändert.
 */
export interface StoredImportIngredient extends NormalizedImportedIngredient {
  manualAssignment: { assignedAt: string; actorUserId: string | null } | null;
}

// ---------------------------------------------------------------------------
// Freigabe-Voraussetzungen (Approve und erneut unmittelbar vor dem Publish)
// ---------------------------------------------------------------------------

export type ApprovalBlockerCode =
  | "validation-error"
  | "unresolved-food"
  | "invalid-food-reference"
  | "incomplete-nutrition"
  | "missing-amount"
  | "missing-prep-time"
  | "missing-instructions"
  | "no-meal-slot"
  | "exact-duplicate"
  | "unacknowledged-duplicate"
  | "quality-error";

export interface ApprovalBlocker {
  code: ApprovalBlockerCode;
  message: string;
  /** Originaltext der betroffenen Zutat, falls zutatenbezogen. */
  ingredient?: string;
}

export interface ApprovalAssessment {
  approvable: boolean;
  blockers: ApprovalBlocker[];
  /** Katalog-Rezepte, die mögliche Duplikate sind: der Reviewer muss sie beim Approve ausdrücklich bestätigen. */
  possibleDuplicateIds: string[];
}

/**
 * Kapitel-18-Errors, die schon durch eigene Blocker abgedeckt sind (Name, Zutaten, Food-Referenzen).
 * Jeder andere Error-Code blockiert zusätzlich als "quality-error", damit ein künftiger neuer
 * Error-Code nie stillschweigend durchrutscht.
 */
const QUALITY_ERRORS_COVERED_BY_BLOCKERS: readonly QualityIssueCode[] = [
  "missing-name",
  "no-ingredient-data",
  "missing-food-reference",
  "invalid-food-reference",
];

function ingredientBlockers(ingredients: readonly NormalizedImportedIngredient[], catalog: FoodCatalog): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  for (const ingredient of ingredients) {
    if (ingredient.resolutionStatus === "unresolved" || ingredient.resolvedFoodId === null) {
      blockers.push({
        code: "unresolved-food",
        message: `Zutat "${ingredient.originalText}" ist keinem Food zugeordnet.`,
        ingredient: ingredient.originalText,
      });
    } else if (!catalog.get(ingredient.resolvedFoodId)) {
      blockers.push({
        code: "invalid-food-reference",
        message: `Zutat "${ingredient.originalText}" verweist auf ein Food, das es im Katalog nicht (mehr) gibt.`,
        ingredient: ingredient.originalText,
      });
    }
  }
  return blockers;
}

/**
 * Nährwerte müssen vollständig berechenbar sein, weil der Publish sie als festen Snapshot in
 * `Recipe` schreibt - eine fehlende Menge oder fehlende Nährwerte würden dort als zu niedrige
 * Werte landen, statt als "unbekannt". Unbekannte Foods melden bereits `ingredientBlockers`.
 */
function nutritionBlockers(evaluation: ImportCandidateEvaluation): ApprovalBlocker[] {
  const { nutrition } = evaluation.nutrition;
  const blockers: ApprovalBlocker[] = [];
  for (const entry of nutrition.unresolved) {
    if (entry.reason === "unknown-food") continue;
    blockers.push({
      code: "incomplete-nutrition",
      message:
        entry.reason === "no-nutrition"
          ? `Für "${entry.displayName}" sind keine Nährwerte hinterlegt.`
          : `Die Menge von "${entry.displayName}" lässt sich nicht in Gramm umrechnen.`,
      ingredient: entry.displayName,
    });
  }
  for (const displayName of nutrition.unquantified) {
    blockers.push({ code: "missing-amount", message: `Für "${displayName}" fehlt die Mengenangabe.`, ingredient: displayName });
  }
  return blockers;
}

/** Felder, die ein Katalog-Rezept braucht und die nicht erfunden werden dürfen (siehe validateSeedData in data/build.ts). */
function catalogFieldBlockers(candidate: ImportedRecipeCandidate): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  if (candidate.prepTimeMin === null || !(candidate.prepTimeMin > 0)) {
    blockers.push({ code: "missing-prep-time", message: "Die Quelle liefert keine Zubereitungszeit." });
  }
  if (!candidate.instructions.some((step) => step.trim() !== "")) {
    blockers.push({ code: "missing-instructions", message: "Die Quelle liefert keine Zubereitungsschritte." });
  }
  if (mealSlotsFromTags(candidate.tags).length === 0) {
    blockers.push({ code: "no-meal-slot", message: "Aus den Tags lässt sich keine Mahlzeit ableiten (z.B. breakfast, lunch, dinner, snack)." });
  }
  return blockers;
}

/**
 * Prüft, ob ein Kandidat freigegeben werden darf. `evaluation` muss frisch gegen den aktuellen
 * Katalog berechnet sein (`evaluateImportCandidate`). Ein Kandidat ist nur freigabefähig, wenn
 * alle Zutaten auf existierende Foods zeigen und keine Validation-Errors vorliegen - genau dann
 * hat der Kapitel-18-Duplicate-Check einen belastbaren Fingerprint und ist wirklich gelaufen.
 */
export function assessApprovalReadiness(evaluation: ImportCandidateEvaluation, catalog: FoodCatalog): ApprovalAssessment {
  const blockers: ApprovalBlocker[] = [
    ...evaluation.validationIssues
      .filter((issue) => issue.severity === "error")
      .map((issue): ApprovalBlocker => ({ code: "validation-error", message: issue.message })),
    ...ingredientBlockers(evaluation.candidate.ingredients, catalog),
    ...nutritionBlockers(evaluation),
    ...catalogFieldBlockers(evaluation.candidate),
  ];

  for (const group of evaluation.duplicates.exactDuplicates) {
    const others = group.recipes.filter((recipe) => !recipe.id.startsWith("import:")).map((recipe) => recipe.name);
    blockers.push({ code: "exact-duplicate", message: `Exaktes strukturelles Duplikat von: ${others.join(", ")}.` });
  }

  for (const issue of evaluation.catalogQualityIssues) {
    if (issue.severity === "error" && !QUALITY_ERRORS_COVERED_BY_BLOCKERS.includes(issue.code)) {
      blockers.push({ code: "quality-error", message: issue.message });
    }
  }

  const possibleDuplicateIds = evaluation.duplicates.possibleDuplicates
    .flatMap((pair) => [pair.recipeA.id, pair.recipeB.id])
    .filter((id) => !id.startsWith("import:"));

  return { approvable: blockers.length === 0, blockers, possibleDuplicateIds: [...new Set(possibleDuplicateIds)].sort() };
}

/** Mögliche Duplikate, die beim Approve noch nicht existierten bzw. nicht bestätigt wurden. */
export function unacknowledgedDuplicateIds(possibleDuplicateIds: readonly string[], acknowledged: readonly string[]): string[] {
  return possibleDuplicateIds.filter((id) => !acknowledged.includes(id));
}

// ---------------------------------------------------------------------------
// Was der Publish in den Katalog schreibt
// ---------------------------------------------------------------------------

export interface PublishTagDecision {
  tags: string[];
  dropped: { tag: string; reason: string }[];
}

const DIETARY_CLASS_TAGS: readonly string[] = TAG_GROUPS.dietary.filter((tag) => tag !== "keto");

/**
 * Tags, die beim Publish übernommen werden. Behauptungen der Quelle werden nicht blind übernommen:
 * die Ernährungsform kommt aus den Zutaten (`deriveDietClass`), nährwertbezogene Tags nur, wenn
 * die berechneten Nährwerte die bestehenden `TAG_NUTRITION_RULES` erfüllen, unbekannte Tags
 * entfallen. Jeder entfallene Tag wird mit Grund zurückgegeben - die Quelle selbst bleibt
 * unverändert im Kandidaten gespeichert.
 */
export function derivePublishTags(sourceTags: readonly string[], dietClass: DietClass, nutrition: NutritionPerServing): PublishTagDecision {
  const kept: string[] = [dietClass];
  const dropped: PublishTagDecision["dropped"] = [];
  const perServing = roundNutrition(nutrition);

  for (const tag of [...new Set(sourceTags.map(normalizeTag))]) {
    if (tag === dietClass) continue;
    if (tagGroup(tag) === "other") {
      dropped.push({ tag, reason: "unbekannter Tag (nicht in der Tag-Registry)" });
    } else if (DIETARY_CLASS_TAGS.includes(tag)) {
      dropped.push({ tag, reason: `Ernährungsform wird aus den Zutaten abgeleitet: ${dietClass}` });
    } else if (TAG_NUTRITION_RULES[tag] && !TAG_NUTRITION_RULES[tag]!(perServing)) {
      dropped.push({ tag, reason: "die berechneten Nährwerte erfüllen die Regel für diesen Tag nicht" });
    } else {
      kept.push(tag);
    }
  }
  return { tags: kept, dropped };
}

/** Slug-Basis aus dem Namen, z.B. "Skyr-Omelett mit Eiersatz" -> "skyr-omelett-mit-eiersatz". */
export function importedRecipeSlugBase(name: string): string {
  const base = normalizeFoodLabel(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "importiertes-rezept";
}

/** Slug-Kandidaten in Reihenfolge: erst der reine Name, bei Kollision mit Kandidaten-Suffix (deterministisch). */
export function importedRecipeSlugOptions(name: string, candidateId: string): [string, string] {
  const base = importedRecipeSlugBase(name);
  return [base, `${base}-${candidateId.slice(-8).toLowerCase()}`];
}

/**
 * Baut aus einem freigegebenen Kandidaten den `RecipeSeed`, den `buildRecipe` (data/build.ts) wie
 * jeden Seed zu einem Katalog-Rezept ableitet - keine zweite Rezept-Erstellungslogik. Die Quelle
 * liefert nur EINE Zeitangabe: sie wird als Zubereitungszeit übernommen, die Kochzeit bleibt
 * unbekannt (der Publish schreibt `cookTimeMin: null`, siehe importQueueService.ts).
 */
export function toPublishSeed(candidate: ImportedRecipeCandidate, slug: string, tags: string[]): RecipeSeed {
  const ingredients = candidate.ingredients.map((ingredient): IngredientSeed => {
    if (ingredient.resolvedFoodId === null) {
      throw new Error(`toPublishSeed: Zutat "${ingredient.originalText}" ist nicht aufgelöst - Freigabeprüfung umgangen?`);
    }
    return {
      food: ingredient.resolvedFoodId,
      name: ingredient.resolvedFoodName ?? ingredient.normalizedLabel,
      ...(ingredient.amount !== null ? { amount: ingredient.amount } : {}),
      ...(ingredient.unit !== null ? { unit: ingredient.unit } : {}),
      optional: ingredient.optional,
    };
  });

  return {
    slug,
    name: candidate.name,
    description: candidate.description,
    servings: candidate.servings,
    tags,
    ingredients,
    instructions: candidate.instructions.filter((step) => step.trim() !== ""),
    prepMin: candidate.prepTimeMin ?? 0,
    cookMin: 0,
    equipment: [],
  };
}
