"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { IMPORT_FIXTURES } from "@/lib/recipes/data/importFixtures";
import {
  approveCandidate,
  assignIngredientFood,
  enqueueImportedRecipe,
  loadImportReviewContext,
  markNeedsChanges,
  publishCandidate,
  rejectCandidate,
  resubmitForReview,
  type WorkflowResult,
} from "@/lib/recipes/importQueueService";
import { createMockExternalRecipeSource } from "@/lib/recipes/recipeImport";
import { requireInternalReviewAccess } from "@/lib/session";

/**
 * Server Actions der Import-Queue (Kapitel 21). Jede Aktion prüft ZUERST serverseitig den Zugriff
 * (`requireInternalReviewAccess`, Kapitel 19): eine Server Action ist auch ohne die UI direkt
 * aufrufbar. Die Actor-ID kommt ausschließlich aus der Session, nie aus dem Formular. Eine
 * Erfolgsmeldung (`?done=`) gibt es erst, nachdem der Service erfolgreich geschrieben hat.
 */

const QUEUE_PATH = "/internal/recipe-review";
const candidateIdSchema = z.string().trim().min(1).max(64);
const noteSchema = z.string().max(2000);
const foodIdSchema = z.string().trim().min(1).max(64);
const ingredientIndexSchema = z.coerce.number().int().min(0).max(500);

function detailPath(candidateId: string, query: string): string {
  return `${QUEUE_PATH}/imports/${encodeURIComponent(candidateId)}?${query}`;
}

function requireCandidateId(formData: FormData): string {
  const parsed = candidateIdSchema.safeParse(formData.get("candidateId"));
  if (!parsed.success) redirect(`${QUEUE_PATH}?importError=INVALID_INPUT`);
  return parsed.data;
}

function readField<T>(formData: FormData, key: string, schema: z.ZodType<T>, candidateId: string): T {
  const parsed = schema.safeParse(formData.get(key));
  if (!parsed.success) redirect(detailPath(candidateId, "error=INVALID_INPUT"));
  return parsed.data;
}

function readNote(formData: FormData, candidateId: string): string | undefined {
  return formData.get("note") === null ? undefined : readField(formData, "note", noteSchema, candidateId);
}

function redirectWithResult(candidateId: string, result: WorkflowResult, done: string): never {
  if (result.ok) redirect(detailPath(candidateId, `done=${done}`));
  if (result.error === "NOT_FOUND") redirect(`${QUEUE_PATH}?importError=NOT_FOUND`);
  redirect(detailPath(candidateId, `error=${result.error}`));
}

export async function markNeedsChangesAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const note = readNote(formData, candidateId);
  redirectWithResult(candidateId, await markNeedsChanges(candidateId, { userId }, note), "needs_changes");
}

export async function resubmitForReviewAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const note = readNote(formData, candidateId);
  redirectWithResult(candidateId, await resubmitForReview(candidateId, { userId }, note), "resubmitted");
}

export async function rejectCandidateAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const reason = readNote(formData, candidateId);
  redirectWithResult(candidateId, await rejectCandidate(candidateId, { userId }, reason), "rejected");
}

export async function approveCandidateAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const note = readNote(formData, candidateId);
  const acknowledgeDuplicates = formData.get("acknowledgeDuplicates") === "on";
  const context = await loadImportReviewContext();
  redirectWithResult(candidateId, await approveCandidate(candidateId, { userId }, context, { acknowledgeDuplicates, note }), "approved");
}

export async function assignIngredientFoodAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const ingredientIndex = readField(formData, "ingredientIndex", ingredientIndexSchema, candidateId);
  const foodId = readField(formData, "foodId", foodIdSchema, candidateId);
  const note = readNote(formData, candidateId);
  const context = await loadImportReviewContext();
  const result = await assignIngredientFood(candidateId, { userId }, context, { ingredientIndex, foodId, note });
  redirectWithResult(candidateId, result, "food_assigned");
}

export async function publishCandidateAction(formData: FormData) {
  const { userId } = await requireInternalReviewAccess();
  const candidateId = requireCandidateId(formData);
  const context = await loadImportReviewContext();
  redirectWithResult(candidateId, await publishCandidate(candidateId, { userId }, context), "published");
}

/**
 * Übernimmt die Mock-Fixtures (Kapitel 20) über die Mock-Quelle in die Queue - die einzige
 * Import-Quelle, solange keine echte externe Quelle angebunden ist. Bereits vorhandene
 * Quellen-IDs werden übersprungen, nie doppelt angelegt.
 */
export async function enqueueMockFixturesAction() {
  const { userId } = await requireInternalReviewAccess();
  const context = await loadImportReviewContext();
  const source = createMockExternalRecipeSource("Mock Recipe Feed", IMPORT_FIXTURES);

  let imported = 0;
  let skipped = 0;
  for (const raw of await source.fetchRecipes()) {
    const result = await enqueueImportedRecipe(raw, context.catalog, { userId });
    if (result.ok) imported++;
    else skipped++;
  }
  redirect(`${QUEUE_PATH}?imported=${imported}&skipped=${skipped}`);
}
