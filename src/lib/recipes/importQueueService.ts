import type { Prisma, RecipeImportCandidate as ImportCandidateRow } from "@prisma/client";
import { prisma } from "../db";
import { isUniqueConstraintError } from "../prismaErrors";
import type { FoodCatalog } from "./catalog";
import type { QualityRecipeInput } from "./catalogQuality";
import { buildRecipe, recipeIngredientRowData, recipeRowData } from "./data/build";
import {
  assessApprovalReadiness,
  canTransition,
  derivePublishTags,
  FOOD_ASSIGNMENT_STATUSES,
  importedRecipeSlugOptions,
  isImportQueueStatus,
  IMPORT_QUEUE_STATUSES,
  toPublishSeed,
  unacknowledgedDuplicateIds,
  type ApprovalAssessment,
  type ApprovalBlocker,
  type ImportQueueStatus,
  type PublishTagDecision,
  type StoredImportIngredient,
} from "./importWorkflow";
import {
  evaluateImportCandidate,
  normalizeImportedRecipe,
  type ImportCandidateEvaluation,
  type ImportedRecipeCandidate,
  type ImportSourceType,
  type RawImportedRecipe,
} from "./recipeImport";
import { loadCatalogQualityInputs, loadFoodCatalog } from "./recipeService";

/**
 * Persistente Recipe-Import-Queue (Kapitel 21). Speichert Kandidaten aus der Kapitel-20-Pipeline,
 * führt die Review-Aktionen als geprüfte Statusübergänge aus und ist die EINZIGE Stelle, die aus
 * einem Import ein Katalog-Rezept erstellt (`publishCandidate`).
 *
 * Grundsätze:
 *  - Bewertungen (Validierung, Nährwerte, Duplikate, Quality) werden nie gespeichert, sondern bei
 *    jedem Aufruf frisch aus den gespeicherten Daten berechnet (`reviewStoredCandidate`).
 *  - Jede Statusänderung ist ein bedingtes Update auf den zuvor gelesenen Zustand (Status +
 *    `updatedAt`) und schreibt im selben Schritt ein `RecipeImportEvent`. Parallele Änderungen
 *    führen zu `CONCURRENT_UPDATE` statt zu einem stillen Überschreiben.
 *  - Autorisierung liegt beim Aufrufer (Server Actions mit `requireInternalReviewAccess()`); die
 *    Actor-ID kommt immer aus der Session, nie aus dem Formular.
 */

export interface ReviewActor {
  userId: string;
}

/** Katalog-Stand, gegen den Kandidaten bewertet werden. Wird pro Request frisch geladen. */
export interface ImportReviewContext {
  catalog: FoodCatalog;
  /** Dieselbe Eingabe wie der Kapitel-18-Report (alle Rezepte inkl. roher Zutatenzeilen). */
  existingRecipes: QualityRecipeInput[];
}

export async function loadImportReviewContext(): Promise<ImportReviewContext> {
  const [catalog, existingRecipes] = await Promise.all([loadFoodCatalog(), loadCatalogQualityInputs()]);
  return { catalog, existingRecipes };
}

// ---------------------------------------------------------------------------
// Abbildung Datenbankzeile <-> Kandidat
// ---------------------------------------------------------------------------

export interface StoredImportCandidate {
  id: string;
  status: ImportQueueStatus;
  /** Normalisierte Daten in der Form, die die Kapitel-20-Bewertung erwartet. */
  candidate: Omit<ImportedRecipeCandidate, "ingredients"> & { ingredients: StoredImportIngredient[] };
  /** Rohdaten der Quelle, unverändert (geparstes `rawPayload`). */
  rawPayload: unknown;
  sourceProvider: string;
  acknowledgedDuplicateIds: string[];
  publishedRecipeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function parseJsonColumn<T>(row: ImportCandidateRow, column: "rawPayload" | "ingredients" | "instructions" | "tags" | "acknowledgedDuplicateIds"): T {
  try {
    return JSON.parse(row[column]) as T;
  } catch {
    throw new Error(`RecipeImportCandidate ${row.id}: Spalte "${column}" enthält kein gültiges JSON.`);
  }
}

function toStoredCandidate(row: ImportCandidateRow): StoredImportCandidate {
  if (!isImportQueueStatus(row.status)) {
    throw new Error(`RecipeImportCandidate ${row.id}: unbekannter Status "${row.status}".`);
  }
  const ingredients = parseJsonColumn<StoredImportIngredient[]>(row, "ingredients");
  const rawPayload = parseJsonColumn<unknown>(row, "rawPayload");

  return {
    id: row.id,
    status: row.status,
    candidate: {
      source: {
        type: row.sourceType as ImportSourceType,
        label: row.sourceProvider,
        ...(row.sourceExternalId ? { externalId: row.sourceExternalId } : {}),
        ...(row.sourceUrl ? { url: row.sourceUrl } : {}),
      },
      name: row.name,
      description: row.description,
      ingredients,
      instructions: parseJsonColumn<string[]>(row, "instructions"),
      prepTimeMin: row.prepTimeMin,
      servings: row.servings,
      tags: parseJsonColumn<string[]>(row, "tags"),
      imageRef: row.imageRef,
      importedAt: row.importedAt,
      rawSourceMetadata: (rawPayload as { rawSourceMetadata?: unknown } | null)?.rawSourceMetadata,
      rawIngredientLines: ingredients.map((ingredient) => ingredient.originalText),
    },
    rawPayload,
    sourceProvider: row.sourceProvider,
    acknowledgedDuplicateIds: parseJsonColumn<string[]>(row, "acknowledgedDuplicateIds"),
    publishedRecipeId: row.publishedRecipeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Int-Spalten: ein gebrochener Quellwert wird gerundet gespeichert, der exakte Wert bleibt im `rawPayload`. */
function toIntColumn(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function toCreateData(raw: RawImportedRecipe, candidate: ImportedRecipeCandidate) {
  const ingredients: StoredImportIngredient[] = candidate.ingredients.map((ingredient) => ({ ...ingredient, manualAssignment: null }));
  return {
    sourceType: candidate.source.type,
    sourceProvider: candidate.source.label,
    sourceExternalId: candidate.source.externalId ?? null,
    sourceUrl: candidate.source.url ?? null,
    name: candidate.name,
    description: candidate.description,
    rawPayload: JSON.stringify(raw),
    ingredients: JSON.stringify(ingredients),
    instructions: JSON.stringify(candidate.instructions),
    servings: Math.max(1, toIntColumn(candidate.servings) ?? 1),
    prepTimeMin: toIntColumn(candidate.prepTimeMin),
    tags: JSON.stringify(candidate.tags),
    imageRef: candidate.imageRef,
    importedAt: candidate.importedAt,
  };
}

// ---------------------------------------------------------------------------
// Audit Trail
// ---------------------------------------------------------------------------

export type ImportEventAction =
  | "imported"
  | "needs_changes"
  | "resubmitted"
  | "rejected"
  | "approved"
  | "food_assigned"
  | "published"
  | "publish_blocked"
  | "publish_error";

interface EventInput {
  action: ImportEventAction;
  note?: string | null;
  details?: unknown;
  recipeId?: string | null;
}

function eventFields(from: ImportQueueStatus | null, to: ImportQueueStatus, actor: ReviewActor | null, event: EventInput) {
  return {
    action: event.action,
    fromStatus: from,
    toStatus: to,
    note: event.note ?? null,
    actorUserId: actor?.userId ?? null,
    recipeId: event.recipeId ?? null,
    details: event.details === undefined ? null : JSON.stringify(event.details),
  };
}

function eventData(candidateId: string, from: ImportQueueStatus | null, to: ImportQueueStatus, actor: ReviewActor | null, event: EventInput) {
  return { candidateId, ...eventFields(from, to, actor, event) };
}

function cleanNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Import in die Queue
// ---------------------------------------------------------------------------

export type EnqueueResult = { ok: true; candidateId: string } | { ok: false; error: "DUPLICATE_SOURCE"; existingCandidateId: string | null };

async function findCandidateBySourceId(candidate: ImportedRecipeCandidate): Promise<{ id: string } | null> {
  const externalId = candidate.source.externalId;
  if (!externalId) return null; // ohne verlässliche Quellen-ID keine Deduplizierung (nie über den Namen)
  return prisma.recipeImportCandidate.findFirst({
    where: { sourceType: candidate.source.type, sourceProvider: candidate.source.label, sourceExternalId: externalId },
    select: { id: true },
  });
}

/**
 * Normalisiert einen Rohimport (Kapitel 20) und legt ihn als `pending_review` an. Auch
 * unvollständige Kandidaten werden gespeichert; ob sie freigabefähig sind, zeigt die Bewertung.
 * Dieselbe Quellen-ID wird nie ein zweites Mal angelegt - auch nicht bei parallelen Aufrufen
 * (Unique-Index, siehe schema.prisma).
 */
export async function enqueueImportedRecipe(raw: RawImportedRecipe, catalog: FoodCatalog, actor: ReviewActor | null): Promise<EnqueueResult> {
  const candidate = normalizeImportedRecipe(raw, catalog);
  const existing = await findCandidateBySourceId(candidate);
  if (existing) return { ok: false, error: "DUPLICATE_SOURCE", existingCandidateId: existing.id };

  try {
    const created = await prisma.recipeImportCandidate.create({
      data: {
        ...toCreateData(raw, candidate),
        events: { create: eventFields(null, "pending_review", actor, { action: "imported", note: `Import über "${candidate.source.label}"` }) },
      },
      select: { id: true },
    });
    return { ok: true, candidateId: created.id };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const winner = await findCandidateBySourceId(candidate);
    return { ok: false, error: "DUPLICATE_SOURCE", existingCandidateId: winner?.id ?? null };
  }
}

// ---------------------------------------------------------------------------
// Lesen und Bewerten
// ---------------------------------------------------------------------------

export interface CandidateReview {
  evaluation: ImportCandidateEvaluation;
  assessment: ApprovalAssessment;
  /** Was der Publish als Tags schreiben würde; `null`, solange die Ernährungsform nicht bestimmbar ist. */
  publishTags: PublishTagDecision | null;
}

/**
 * Bewertet einen gespeicherten Kandidaten frisch gegen den aktuellen Katalog. Ein bereits
 * veröffentlichter Kandidat wird nicht mit seinem eigenen Katalog-Rezept verglichen.
 */
export function reviewStoredCandidate(stored: StoredImportCandidate, context: ImportReviewContext): CandidateReview {
  const existingRecipes = stored.publishedRecipeId
    ? context.existingRecipes.filter((recipe) => recipe.id !== stored.publishedRecipeId)
    : context.existingRecipes;
  const evaluation = evaluateImportCandidate(stored.candidate, context.catalog, existingRecipes);
  const assessment = assessApprovalReadiness(evaluation, context.catalog);
  const dietClass = evaluation.profile.dietClass;
  const publishTags = dietClass ? derivePublishTags(stored.candidate.tags, dietClass, evaluation.nutrition.nutrition.perServing) : null;
  return { evaluation, assessment, publishTags };
}

async function loadStoredCandidate(candidateId: string): Promise<StoredImportCandidate | null> {
  const row = await prisma.recipeImportCandidate.findUnique({ where: { id: candidateId } });
  return row ? toStoredCandidate(row) : null;
}

export interface ImportQueueListItem {
  id: string;
  name: string;
  sourceType: string;
  sourceProvider: string;
  importedAt: Date;
  status: ImportQueueStatus;
  ingredientCount: number;
  unresolvedFoods: string[];
  missingNutrition: string[];
  exactDuplicateNames: string[];
  possibleDuplicateNames: string[];
  qualityIssueCount: number;
  approvable: boolean;
  blockerCount: number;
}

export interface ImportQueueOverview {
  items: ImportQueueListItem[];
  countsByStatus: Record<ImportQueueStatus, number>;
  total: number;
}

function toListItem(stored: StoredImportCandidate, review: CandidateReview): ImportQueueListItem {
  const { evaluation, assessment } = review;
  const importId = (id: string) => id.startsWith("import:");
  return {
    id: stored.id,
    name: stored.candidate.name || "(kein Name)",
    sourceType: stored.candidate.source.type,
    sourceProvider: stored.sourceProvider,
    importedAt: stored.candidate.importedAt,
    status: stored.status,
    ingredientCount: stored.candidate.ingredients.length,
    unresolvedFoods: stored.candidate.ingredients.filter((i) => i.resolutionStatus === "unresolved").map((i) => i.originalText),
    missingNutrition: evaluation.validationIssues.filter((issue) => issue.code === "missing-nutrition").map((issue) => issue.ingredient ?? issue.message),
    exactDuplicateNames: evaluation.duplicates.exactDuplicates.flatMap((group) => group.recipes.filter((r) => !importId(r.id)).map((r) => r.name)),
    possibleDuplicateNames: evaluation.duplicates.possibleDuplicates.flatMap((pair) => [pair.recipeA, pair.recipeB].filter((r) => !importId(r.id)).map((r) => r.name)),
    qualityIssueCount: evaluation.catalogQualityIssues.length,
    approvable: assessment.approvable,
    blockerCount: assessment.blockers.length,
  };
}

/** Übersicht für die Review-Seite. `statusFilter = null` zeigt alle Kandidaten. */
export async function listImportQueue(context: ImportReviewContext, statusFilter: ImportQueueStatus | null): Promise<ImportQueueOverview> {
  const rows = await prisma.recipeImportCandidate.findMany({ orderBy: [{ importedAt: "desc" }, { createdAt: "desc" }] });
  const stored = rows.map(toStoredCandidate);

  const countsByStatus = Object.fromEntries(IMPORT_QUEUE_STATUSES.map((status) => [status, 0])) as Record<ImportQueueStatus, number>;
  for (const candidate of stored) countsByStatus[candidate.status]++;

  const items = stored
    .filter((candidate) => statusFilter === null || candidate.status === statusFilter)
    .map((candidate) => toListItem(candidate, reviewStoredCandidate(candidate, context)));

  return { items, countsByStatus, total: stored.length };
}

export interface ImportEventView {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorName: string | null;
  actorUserId: string | null;
  recipeId: string | null;
  details: unknown;
  createdAt: Date;
}

export interface ImportCandidateDetail {
  stored: StoredImportCandidate;
  events: ImportEventView[];
}

/** Kandidat samt Audit Trail (älteste zuerst). Actor-Namen werden nur zur Anzeige nachgeschlagen. */
export async function getImportCandidateDetail(candidateId: string): Promise<ImportCandidateDetail | null> {
  const row = await prisma.recipeImportCandidate.findUnique({
    where: { id: candidateId },
    include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!row) return null;

  const actorIds = [...new Set(row.events.map((event) => event.actorUserId).filter((id): id is string => id !== null))];
  const actors = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(actors.map((actor) => [actor.id, actor.name]));

  return {
    stored: toStoredCandidate(row),
    events: row.events.map((event) => ({
      id: event.id,
      action: event.action,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      actorUserId: event.actorUserId,
      actorName: event.actorUserId ? (nameById.get(event.actorUserId) ?? null) : null,
      recipeId: event.recipeId,
      details: event.details ? (JSON.parse(event.details) as unknown) : null,
      createdAt: event.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Review-Aktionen
// ---------------------------------------------------------------------------

export type WorkflowErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "CONCURRENT_UPDATE"
  | "NOTE_REQUIRED"
  | "NOT_APPROVABLE"
  | "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED"
  | "ASSIGNMENT_NOT_ALLOWED"
  | "INGREDIENT_NOT_FOUND"
  | "INGREDIENT_ALREADY_RESOLVED"
  | "FOOD_NOT_FOUND"
  | "NOT_APPROVED"
  | "ALREADY_PUBLISHED"
  | "ALREADY_IN_CATALOG"
  | "PUBLISH_BLOCKED"
  | "PUBLISH_FAILED";

export type WorkflowResult =
  | { ok: true; recipeId?: string }
  | { ok: false; error: WorkflowErrorCode; blockers?: ApprovalBlocker[]; recipeId?: string | null };

/** Der gelesene Zustand ist inzwischen veraltet (paralleler Request) - Transaktion zurückrollen. */
class StaleCandidateError extends Error {
  constructor() {
    super("Import-Kandidat wurde parallel geändert.");
  }
}

/**
 * Führt einen Statusübergang aus: nur wenn er laut `canTransition` erlaubt ist und der Kandidat
 * seit dem Lesen unverändert ist. Status und Audit-Eintrag werden gemeinsam geschrieben.
 */
async function transitionCandidate(
  stored: StoredImportCandidate,
  to: ImportQueueStatus,
  actor: ReviewActor,
  event: EventInput,
  extraData: { acknowledgedDuplicateIds?: string } = {},
): Promise<WorkflowResult> {
  if (!canTransition(stored.status, to)) return { ok: false, error: "INVALID_TRANSITION" };
  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.recipeImportCandidate.updateMany({
        where: { id: stored.id, status: stored.status, updatedAt: stored.updatedAt },
        data: { status: to, ...extraData },
      });
      if (updated.count !== 1) throw new StaleCandidateError();
      await tx.recipeImportEvent.create({ data: eventData(stored.id, stored.status, to, actor, event) });
    });
  } catch (error) {
    if (error instanceof StaleCandidateError) return { ok: false, error: "CONCURRENT_UPDATE" };
    throw error;
  }
  return { ok: true };
}

/** pending_review | failed -> needs_changes, optional mit interner Notiz. */
export async function markNeedsChanges(candidateId: string, actor: ReviewActor, note?: string | null): Promise<WorkflowResult> {
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  return transitionCandidate(stored, "needs_changes", actor, { action: "needs_changes", note: cleanNote(note) });
}

/** needs_changes -> pending_review: nach einer Überarbeitung (z.B. Food-Zuordnung) erneut zur Prüfung. */
export async function resubmitForReview(candidateId: string, actor: ReviewActor, note?: string | null): Promise<WorkflowResult> {
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  return transitionCandidate(stored, "pending_review", actor, { action: "resubmitted", note: cleanNote(note) });
}

/** -> rejected, nur mit nachvollziehbarem Grund. Endgültig. */
export async function rejectCandidate(candidateId: string, actor: ReviewActor, reason: string | null | undefined): Promise<WorkflowResult> {
  const note = cleanNote(reason);
  if (note === null) return { ok: false, error: "NOTE_REQUIRED" };
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  return transitionCandidate(stored, "rejected", actor, { action: "rejected", note });
}

export interface ApprovalDecision {
  /** Reviewer bestätigt ausdrücklich die angezeigten möglichen Duplikate. */
  acknowledgeDuplicates: boolean;
  note?: string | null;
}

/**
 * pending_review -> approved. Nur wenn die frische Bewertung keine Blocker hat. Mögliche Duplikate
 * blockieren nicht, brauchen aber eine dokumentierte Entscheidung (Bestätigung + Begründung);
 * die bestätigten IDs werden gespeichert und vor dem Publish erneut geprüft. Erstellt KEIN Rezept.
 */
export async function approveCandidate(
  candidateId: string,
  actor: ReviewActor,
  context: ImportReviewContext,
  decision: ApprovalDecision,
): Promise<WorkflowResult> {
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  if (!canTransition(stored.status, "approved")) return { ok: false, error: "INVALID_TRANSITION" };

  const { assessment } = reviewStoredCandidate(stored, context);
  if (!assessment.approvable) return { ok: false, error: "NOT_APPROVABLE", blockers: assessment.blockers };

  const note = cleanNote(decision.note);
  const hasPossibleDuplicates = assessment.possibleDuplicateIds.length > 0;
  if (hasPossibleDuplicates && (!decision.acknowledgeDuplicates || note === null)) {
    return { ok: false, error: "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED" };
  }

  return transitionCandidate(
    stored,
    "approved",
    actor,
    { action: "approved", note, details: { acknowledgedDuplicateIds: assessment.possibleDuplicateIds } },
    { acknowledgedDuplicateIds: JSON.stringify(assessment.possibleDuplicateIds) },
  );
}

export interface FoodAssignmentInput {
  ingredientIndex: number;
  foodId: string;
  note?: string | null;
}

/**
 * Ordnet eine UNAUFGELÖSTE Zutat einem existierenden Food des zentralen Katalogs zu. Legt nie ein
 * Food an, ändert weder Originaltext noch Menge/Einheit und dokumentiert die Zuordnung an der
 * Zutat (`manualAssignment`) und im Audit Trail. Gibt die frische Neubewertung zurück
 * (Validierung, Nährwerte, Duplikate laufen mit der neuen Zuordnung erneut).
 */
export async function assignIngredientFood(
  candidateId: string,
  actor: ReviewActor,
  context: ImportReviewContext,
  input: FoodAssignmentInput,
): Promise<WorkflowResult & { review?: CandidateReview }> {
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  if (!FOOD_ASSIGNMENT_STATUSES.includes(stored.status)) return { ok: false, error: "ASSIGNMENT_NOT_ALLOWED" };

  const ingredient = Number.isInteger(input.ingredientIndex) ? stored.candidate.ingredients[input.ingredientIndex] : undefined;
  if (!ingredient) return { ok: false, error: "INGREDIENT_NOT_FOUND" };
  if (ingredient.resolutionStatus !== "unresolved") return { ok: false, error: "INGREDIENT_ALREADY_RESOLVED" };

  const food = context.catalog.get(input.foodId);
  if (!food) return { ok: false, error: "FOOD_NOT_FOUND" };

  const assignedAt = new Date().toISOString();
  const ingredients: StoredImportIngredient[] = stored.candidate.ingredients.map((entry, index) =>
    index === input.ingredientIndex
      ? {
          ...entry,
          resolutionStatus: "resolved",
          resolvedFoodId: food.id,
          resolvedFoodName: food.name,
          manualAssignment: { assignedAt, actorUserId: actor.userId },
        }
      : entry,
  );

  try {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.recipeImportCandidate.updateMany({
        where: { id: stored.id, status: stored.status, updatedAt: stored.updatedAt },
        data: { ingredients: JSON.stringify(ingredients) },
      });
      if (updated.count !== 1) throw new StaleCandidateError();
      await tx.recipeImportEvent.create({
        data: eventData(stored.id, stored.status, stored.status, actor, {
          action: "food_assigned",
          note: cleanNote(input.note),
          details: { ingredientIndex: input.ingredientIndex, originalText: ingredient.originalText, foodId: food.id, foodName: food.name },
        }),
      });
    });
  } catch (error) {
    if (error instanceof StaleCandidateError) return { ok: false, error: "CONCURRENT_UPDATE" };
    throw error;
  }

  const refreshed = await loadStoredCandidate(candidateId);
  return { ok: true, review: refreshed ? reviewStoredCandidate(refreshed, context) : undefined };
}

// ---------------------------------------------------------------------------
// Publish: einzige Stelle, die aus einem Import ein Katalog-Rezept erstellt
// ---------------------------------------------------------------------------

class PublishConflictError extends Error {
  constructor(
    readonly code: "CONCURRENT_UPDATE" | "ALREADY_IN_CATALOG",
    readonly recipeId: string | null = null,
  ) {
    super(`Publish-Konflikt: ${code}`);
  }
}

/** Blocker, die unmittelbar vor dem Publish gelten: die Approve-Blocker plus seither neu aufgetauchte mögliche Duplikate. */
function publishBlockers(stored: StoredImportCandidate, review: CandidateReview): ApprovalBlocker[] {
  const newDuplicates = unacknowledgedDuplicateIds(review.assessment.possibleDuplicateIds, stored.acknowledgedDuplicateIds);
  return [
    ...review.assessment.blockers,
    ...(newDuplicates.length > 0
      ? [{ code: "unacknowledged-duplicate" as const, message: `Seit der Freigabe neue mögliche Duplikate im Katalog (${newDuplicates.length}).` }]
      : []),
  ];
}

async function chooseFreeSlug(tx: Prisma.TransactionClient, name: string, candidateId: string): Promise<string> {
  for (const slug of importedRecipeSlugOptions(name, candidateId)) {
    const taken = await tx.recipe.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  throw new Error(`Kein freier Slug für "${name}" (${candidateId}).`);
}

/**
 * Innerhalb EINER Transaktion: Kandidat beanspruchen (bedingtes Update, blockiert parallele
 * Publishes), Recipe und RecipeIngredients über dieselbe Abbildung wie der Seed anlegen
 * (`buildRecipe` + `recipeRowData`), erst danach Status `published` + Recipe-ID setzen und den
 * Audit-Eintrag schreiben. Jeder Fehler rollt alles zurück.
 */
async function createCatalogRecipe(
  tx: Prisma.TransactionClient,
  stored: StoredImportCandidate,
  catalog: FoodCatalog,
  tags: PublishTagDecision,
  actor: ReviewActor,
): Promise<string> {
  const claimed = await tx.recipeImportCandidate.updateMany({
    where: { id: stored.id, status: "approved", publishedRecipeId: null, updatedAt: stored.updatedAt },
    data: { updatedAt: new Date() },
  });
  if (claimed.count !== 1) throw new PublishConflictError("CONCURRENT_UPDATE");

  const externalId = stored.candidate.source.externalId ?? null;
  if (externalId) {
    const existing = await tx.recipe.findFirst({
      where: { sourceType: "external", sourceProvider: stored.sourceProvider, sourceExternalId: externalId },
      select: { id: true },
    });
    if (existing) throw new PublishConflictError("ALREADY_IN_CATALOG", existing.id);
  }

  const slug = await chooseFreeSlug(tx, stored.candidate.name, stored.id);
  const built = buildRecipe(toPublishSeed(stored.candidate, slug, tags.tags), catalog);

  const recipe = await tx.recipe.create({
    data: {
      ...recipeRowData(built),
      cookTimeMin: null, // die Quelle liefert nur eine Zeitangabe (siehe toPublishSeed)
      slug,
      sourceType: "external",
      sourceProvider: stored.sourceProvider,
      sourceExternalId: externalId,
    },
    select: { id: true },
  });
  await tx.recipeIngredient.createMany({
    data: built.ingredients.map((ingredient, position) => ({
      recipeId: recipe.id,
      ...recipeIngredientRowData(ingredient, position, ingredient.foodId),
    })),
  });

  await tx.recipeImportCandidate.update({ where: { id: stored.id }, data: { status: "published", publishedRecipeId: recipe.id } });
  await tx.recipeImportEvent.create({
    data: eventData(stored.id, "approved", "published", actor, {
      action: "published",
      recipeId: recipe.id,
      details: { slug, tags: tags.tags, droppedTags: tags.dropped },
    }),
  });
  return recipe.id;
}

async function recordPublishEvent(stored: StoredImportCandidate, actor: ReviewActor, details: Record<string, unknown>): Promise<void> {
  try {
    await prisma.recipeImportEvent.create({ data: eventData(stored.id, "approved", "approved", actor, { action: "publish_error", details }) });
  } catch (auditError) {
    console.error(`[import-queue] Publish-Fehler für ${stored.id} konnte nicht protokolliert werden`, auditError);
  }
}

async function handlePublishFailure(stored: StoredImportCandidate, actor: ReviewActor, error: unknown): Promise<WorkflowResult> {
  const current = await prisma.recipeImportCandidate.findUnique({ where: { id: stored.id }, select: { status: true, publishedRecipeId: true } });
  if (current?.status === "published") return { ok: false, error: "ALREADY_PUBLISHED", recipeId: current.publishedRecipeId };

  if (error instanceof PublishConflictError) {
    if (error.code === "ALREADY_IN_CATALOG") await recordPublishEvent(stored, actor, { code: error.code, recipeId: error.recipeId });
    return { ok: false, error: error.code, recipeId: error.recipeId };
  }

  console.error(`[import-queue] Publish von ${stored.id} fehlgeschlagen, Transaktion zurückgerollt`, error);
  await recordPublishEvent(stored, actor, { code: "PUBLISH_FAILED", message: error instanceof Error ? error.message : String(error) });
  return { ok: false, error: "PUBLISH_FAILED" };
}

/**
 * approved -> published. Prüft unmittelbar vorher erneut Validierung, Food-Referenzen, Nährwerte
 * und Duplikate gegen den aktuellen Katalog. Trägt die Freigabe nicht mehr, wird der Kandidat
 * `failed` (mit Gründen im Audit Trail) und es entsteht kein Rezept. Idempotent: ein bereits
 * veröffentlichter Kandidat liefert `ALREADY_PUBLISHED` samt bestehender Recipe-ID, parallele
 * Aufrufe erzeugen höchstens ein Rezept.
 */
export async function publishCandidate(candidateId: string, actor: ReviewActor, context: ImportReviewContext): Promise<WorkflowResult> {
  const stored = await loadStoredCandidate(candidateId);
  if (!stored) return { ok: false, error: "NOT_FOUND" };
  if (stored.status === "published") return { ok: false, error: "ALREADY_PUBLISHED", recipeId: stored.publishedRecipeId };
  if (!canTransition(stored.status, "published")) return { ok: false, error: "NOT_APPROVED" };

  const review = reviewStoredCandidate(stored, context);
  const blockers = publishBlockers(stored, review);
  if (blockers.length > 0) {
    const blocked = await transitionCandidate(stored, "failed", actor, { action: "publish_blocked", details: { blockers } });
    if (!blocked.ok) return handlePublishFailure(stored, actor, new PublishConflictError("CONCURRENT_UPDATE"));
    return { ok: false, error: "PUBLISH_BLOCKED", blockers };
  }

  const tags = review.publishTags;
  if (tags === null) {
    // Ohne Blocker sind alle Zutaten aufgelöst, also ist die Ernährungsform bestimmbar.
    throw new Error(`publishCandidate: Ernährungsform für ${stored.id} nicht bestimmbar, obwohl keine Blocker vorliegen.`);
  }
  try {
    const recipeId = await prisma.$transaction((tx) => createCatalogRecipe(tx, stored, context.catalog, tags, actor));
    return { ok: true, recipeId };
  } catch (error) {
    return handlePublishFailure(stored, actor, error);
  }
}
