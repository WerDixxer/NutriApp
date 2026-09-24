import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label, Select, Textarea } from "@/components/ui/Field";
import { SectionHeader } from "@/components/ui/SectionHeader";
import {
  IMPORT_DONE_MESSAGES,
  IMPORT_ERROR_MESSAGES,
  IMPORT_EVENT_LABELS,
  IMPORT_QUEUE_STATUS_LABELS,
  QUALITY_SEVERITY_LABELS,
} from "@/lib/labels";
import type { FoodCatalog } from "@/lib/recipes/catalog";
import {
  getImportCandidateDetail,
  loadImportReviewContext,
  reviewStoredCandidate,
  type CandidateReview,
  type ImportEventView,
  type StoredImportCandidate,
} from "@/lib/recipes/importQueueService";
import { FOOD_ASSIGNMENT_STATUSES, type StoredImportIngredient } from "@/lib/recipes/importWorkflow";
import { roundNutrition } from "@/lib/recipes/nutrition";
import { formatNormalizedIngredient, toRecipeReviewItem } from "@/lib/recipes/recipeImport";
import { requireInternalReviewAccess } from "@/lib/session";
import { DuplicateCandidateCard } from "../../DuplicateCandidateCard";
import {
  approveCandidateAction,
  assignIngredientFoodAction,
  markNeedsChangesAction,
  publishCandidateAction,
  rejectCandidateAction,
  resubmitForReviewAction,
} from "../actions";
import { formatReviewDate, IMPORT_STATUS_TONE } from "../display";
import { SubmitButton } from "../SubmitButton";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-label text-ink-faint">{title}</h2>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function Notice({ query }: { query: Record<string, string | string[] | undefined> }) {
  const done = typeof query.done === "string" ? IMPORT_DONE_MESSAGES[query.done] : undefined;
  const error = typeof query.error === "string" ? (IMPORT_ERROR_MESSAGES[query.error] ?? "Die Aktion konnte nicht ausgeführt werden.") : undefined;
  if (!done && !error) return null;
  return (
    <p role={error ? "alert" : "status"} className={`rounded-[var(--radius-md)] bg-bg-dim px-4 py-3 text-[13.5px] font-medium ${error ? "text-danger" : "text-ink"}`}>
      {error ?? done}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Freigabe-Prüfung und Aktionen
// ---------------------------------------------------------------------------

function ApprovalPanel({ stored, review }: { stored: StoredImportCandidate; review: CandidateReview }) {
  const { assessment, publishTags } = review;
  const duplicatesAcknowledged =
    assessment.possibleDuplicateIds.length > 0 && assessment.possibleDuplicateIds.every((id) => stored.acknowledgedDuplicateIds.includes(id));
  return (
    <Panel title="Freigabe-Prüfung (frisch gegen den aktuellen Katalog berechnet)">
      {assessment.approvable ? (
        <p className="text-[13.5px] font-medium text-primary">Alle Voraussetzungen erfüllt.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {assessment.blockers.map((blocker, i) => (
            <li key={i} className="text-[13.5px] text-ink">
              <span className="text-label text-danger">Blockiert</span> <span className="text-ink-soft">{blocker.message}</span>
            </li>
          ))}
        </ul>
      )}
      {assessment.possibleDuplicateIds.length > 0 && (
        <p className="mt-2 text-[13px] text-warn">
          {duplicatesAcknowledged
            ? `${assessment.possibleDuplicateIds.length} mögliche(s) Duplikat(e) wurde(n) bei der Freigabe bewusst bestätigt (siehe Verlauf).`
            : `${assessment.possibleDuplicateIds.length} mögliche(s) Duplikat(e): Freigabe nur mit ausdrücklicher Bestätigung und Begründung.`}
        </p>
      )}
      {publishTags && (
        <div className="mt-3 text-[13px] text-ink-soft">
          <p>
            Tags beim Publish: <span className="font-medium text-ink">{publishTags.tags.join(", ")}</span>
          </p>
          {publishTags.dropped.length > 0 && (
            <ul className="mt-1 list-inside list-disc">
              {publishTags.dropped.map((entry) => (
                <li key={entry.tag}>
                  „{entry.tag}“ entfällt: {entry.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Panel>
  );
}

function NoteField({ id, label, required, hint }: { id: string; label: string; required?: boolean; hint?: string }) {
  return (
    <div>
      <Label htmlFor={id} hint={hint}>
        {label}
      </Label>
      <Textarea id={id} name="note" rows={2} maxLength={2000} required={required} />
    </div>
  );
}

function ActionForm({
  action,
  candidateId,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  candidateId: string;
  children: React.ReactNode;
}) {
  return (
    <form action={action} className="flex flex-col gap-2.5 rounded-[var(--radius-md)] bg-bg p-4">
      <input type="hidden" name="candidateId" value={candidateId} />
      {children}
    </form>
  );
}

function ActionsPanel({ stored, review }: { stored: StoredImportCandidate; review: CandidateReview }) {
  const { id, status } = stored;
  const needsAck = review.assessment.possibleDuplicateIds.length > 0;

  if (status === "rejected" || status === "published") {
    return (
      <Panel title="Aktionen">
        <p className="text-[13.5px] text-ink-soft">Abgeschlossen ({IMPORT_QUEUE_STATUS_LABELS[status]}). Keine weiteren Aktionen möglich.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Aktionen">
      <div className="grid gap-3 md:grid-cols-2">
        {status === "pending_review" && (
          <ActionForm action={approveCandidateAction} candidateId={id}>
            <p className="text-[13.5px] font-semibold text-ink">Freigeben</p>
            <p className="text-[12.5px] text-ink-soft">Erstellt noch kein Rezept. Veröffentlichen ist ein eigener Schritt.</p>
            {needsAck && (
              <label className="flex items-start gap-2 text-[13px] text-ink">
                <input type="checkbox" name="acknowledgeDuplicates" className="mt-0.5" />
                Ich habe die möglichen Duplikate geprüft; das Rezept ist bewusst eigenständig.
              </label>
            )}
            <NoteField id="approve-note" label="Begründung" required={needsAck} hint={needsAck ? "Pflicht bei möglichen Duplikaten" : "optional"} />
            <SubmitButton disabled={!review.assessment.approvable}>Freigeben</SubmitButton>
          </ActionForm>
        )}

        {status === "approved" && (
          <ActionForm action={publishCandidateAction} candidateId={id}>
            <p className="text-[13.5px] font-semibold text-ink">Im Katalog veröffentlichen</p>
            <p className="text-[12.5px] text-ink-soft">
              Prüft Validierung, Food-Referenzen, Nährwerte und Duplikate unmittelbar vorher erneut. Erstellt genau ein Katalog-Rezept.
            </p>
            <SubmitButton pendingLabel="Wird veröffentlicht …">Veröffentlichen</SubmitButton>
          </ActionForm>
        )}

        {status === "needs_changes" && (
          <ActionForm action={resubmitForReviewAction} candidateId={id}>
            <p className="text-[13.5px] font-semibold text-ink">Erneut zur Prüfung</p>
            <NoteField id="resubmit-note" label="Notiz" hint="optional" />
            <SubmitButton variant="secondary">Zur Prüfung stellen</SubmitButton>
          </ActionForm>
        )}

        {(status === "pending_review" || status === "failed") && (
          <ActionForm action={markNeedsChangesAction} candidateId={id}>
            <p className="text-[13.5px] font-semibold text-ink">Überarbeitung nötig</p>
            <NoteField id="needs-changes-note" label="Interne Notiz" hint="optional" />
            <SubmitButton variant="secondary">Markieren</SubmitButton>
          </ActionForm>
        )}

        {status !== "approved" && (
          <ActionForm action={rejectCandidateAction} candidateId={id}>
            <p className="text-[13.5px] font-semibold text-ink">Ablehnen</p>
            <NoteField id="reject-note" label="Grund" required hint="Pflicht" />
            <SubmitButton variant="bordered">Ablehnen</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Zutaten: Originaltext und Interpretation
// ---------------------------------------------------------------------------

function resolutionText(ingredient: StoredImportIngredient, catalog: FoodCatalog): { text: string; tone: string } {
  if (ingredient.resolutionStatus === "unresolved" || ingredient.resolvedFoodId === null) return { text: "nicht zugeordnet", tone: "text-warn" };
  if (!catalog.get(ingredient.resolvedFoodId)) return { text: "Food existiert nicht mehr im Katalog", tone: "text-danger" };
  if (ingredient.manualAssignment) {
    return { text: `manuell zugeordnet (${formatReviewDate(new Date(ingredient.manualAssignment.assignedAt))})`, tone: "text-ink-soft" };
  }
  return { text: "automatisch zugeordnet", tone: "text-ink-soft" };
}

function FoodAssignmentForm({ candidateId, index, foods }: { candidateId: string; index: number; foods: { id: string; name: string }[] }) {
  return (
    <form action={assignIngredientFoodAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="candidateId" value={candidateId} />
      <input type="hidden" name="ingredientIndex" value={index} />
      <div className="min-w-[12rem] flex-1">
        <Label htmlFor={`assign-food-${index}`}>Existierendem Food zuordnen</Label>
        <Select id={`assign-food-${index}`} name="foodId" required defaultValue="">
          <option value="" disabled>
            Food wählen …
          </option>
          {foods.map((food) => (
            <option key={food.id} value={food.id}>
              {food.name}
            </option>
          ))}
        </Select>
      </div>
      <SubmitButton variant="secondary">Zuordnen</SubmitButton>
    </form>
  );
}

function IngredientsPanel({ stored, catalog }: { stored: StoredImportCandidate; catalog: FoodCatalog }) {
  const canAssign = FOOD_ASSIGNMENT_STATUSES.includes(stored.status);
  const foods = catalog
    .all()
    .map((food) => ({ id: food.id, name: food.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  return (
    <Panel title={`Zutaten: Originaltext und Interpretation (${stored.candidate.ingredients.length})`}>
      <ul className="flex flex-col gap-3">
        {stored.candidate.ingredients.map((ingredient, index) => {
          const resolution = resolutionText(ingredient, catalog);
          const unresolved = ingredient.resolutionStatus === "unresolved";
          return (
            <li key={index} className="rounded-[var(--radius-md)] bg-bg p-3">
              <p className="text-[13.5px] text-ink">
                Original: <span className="font-medium">„{ingredient.originalText}“</span>
              </p>
              <p className="mt-0.5 text-[13px] text-ink-soft">
                Interpretation: {unresolved ? `Label „${ingredient.normalizedLabel}“` : formatNormalizedIngredient(ingredient)}
                {" · "}
                <span className={resolution.tone}>{resolution.text}</span>
                {(ingredient.amount === null || ingredient.unit === null) && <span className="text-warn"> · Menge/Einheit nicht erkannt</span>}
                {ingredient.optional && " · optional"}
              </p>
              {unresolved && canAssign && <FoodAssignmentForm candidateId={stored.id} index={index} foods={foods} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Bewertung: Nährwerte, Validierung, Quality, Duplikate
// ---------------------------------------------------------------------------

function NutritionPanel({ review }: { review: CandidateReview }) {
  const { nutrition, unresolvedIngredientCount } = review.evaluation.nutrition;
  const n = roundNutrition(nutrition.perServing);
  const complete = nutrition.complete && nutrition.unquantified.length === 0 && unresolvedIngredientCount === 0;
  return (
    <Panel title="Nährwerte (pro Portion, berechnet aus aufgelösten Zutaten)">
      <p className={`text-[13.5px] font-medium ${complete ? "text-primary" : "text-warn"}`}>{complete ? "Vollständig" : "Unvollständig – Werte sind zu niedrig und werden nicht veröffentlicht"}</p>
      <p className="num mt-1 text-[13px] text-ink-soft">
        {n.kcal} kcal · {n.proteinG} g Protein · {n.carbsG} g Kohlenhydrate · {n.fatG} g Fett
      </p>
      {(nutrition.unresolved.length > 0 || nutrition.unquantified.length > 0 || unresolvedIngredientCount > 0) && (
        <ul className="mt-2 list-inside list-disc text-[13px] text-ink-soft">
          {unresolvedIngredientCount > 0 && <li>{unresolvedIngredientCount} nicht zugeordnete Zutat(en) fließen nicht ein</li>}
          {nutrition.unresolved.map((entry, i) => (
            <li key={i}>
              {entry.displayName}: {entry.reason === "no-nutrition" ? "keine Nährwerte hinterlegt" : entry.reason === "no-unit-conversion" ? "Einheit nicht umrechenbar" : "unbekanntes Food"}
            </li>
          ))}
          {nutrition.unquantified.map((name) => (
            <li key={name}>{name}: keine Mengenangabe</li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FindingsPanels({ stored, review }: { stored: StoredImportCandidate; review: CandidateReview }) {
  const { evaluation } = review;
  const duplicateCandidates = toRecipeReviewItem(evaluation).duplicateCandidates;
  return (
    <>
      {evaluation.validationIssues.length > 0 && (
        <Panel title={`Validierung (${evaluation.validationIssues.length})`}>
          <ul className="flex flex-col gap-1.5">
            {evaluation.validationIssues.map((issue, i) => (
              <li key={i} className="text-[13.5px]">
                <span className={`text-label ${issue.severity === "error" ? "text-danger" : "text-warn"}`}>{issue.severity === "error" ? "Fehler" : "Warnung"}</span>{" "}
                <span className="text-ink-soft">{issue.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {evaluation.catalogQualityIssues.length > 0 && (
        <Panel title={`Quality Issues (${evaluation.catalogQualityIssues.length})`}>
          <ul className="flex flex-col gap-1.5">
            {evaluation.catalogQualityIssues.map((issue, i) => (
              <li key={i} className="text-[13.5px]">
                <span className="text-label text-ink-faint">{QUALITY_SEVERITY_LABELS[issue.severity]}</span> <span className="text-ink-soft">{issue.message}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={`Duplicate-Kandidaten (${duplicateCandidates.length})`}>
        {evaluation.status === "validation_failed" || stored.candidate.ingredients.some((i) => i.resolutionStatus === "unresolved") ? (
          <p className="text-[13.5px] text-ink-soft">Kein belastbarer Duplikat-Vergleich möglich, solange Name, Zutaten oder Food-Zuordnungen fehlen.</p>
        ) : duplicateCandidates.length === 0 ? (
          <p className="text-[13.5px] text-ink-soft">Keine exakten oder möglichen Duplikate im Katalog gefunden.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {duplicateCandidates.map((candidate) => (
              <DuplicateCandidateCard key={`${candidate.kind}-${candidate.recipe.id}`} recipeName={stored.candidate.name} candidate={candidate} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

// ---------------------------------------------------------------------------
// Rezeptdaten, Rohdaten, Verlauf
// ---------------------------------------------------------------------------

function RecipeDataPanel({ stored }: { stored: StoredImportCandidate }) {
  const { candidate } = stored;
  return (
    <Panel title="Normalisierte Rezeptdaten">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        <dt className="text-ink-soft">Portionen</dt>
        <dd className="num text-ink">{candidate.servings}</dd>
        <dt className="text-ink-soft">Zeit</dt>
        <dd className="num text-ink">{candidate.prepTimeMin !== null ? `${candidate.prepTimeMin} min` : "– (von der Quelle nicht geliefert)"}</dd>
        <dt className="text-ink-soft">Tags der Quelle</dt>
        <dd className="text-ink">{candidate.tags.length > 0 ? candidate.tags.join(", ") : "–"}</dd>
        <dt className="text-ink-soft">Beschreibung</dt>
        <dd className="text-ink">{candidate.description || "–"}</dd>
      </dl>
      <p className="mt-3 text-[12.5px] font-semibold text-ink-soft">Zubereitung</p>
      {candidate.instructions.length > 0 ? (
        <ol className="mt-1 list-inside list-decimal text-[13.5px] text-ink">
          {candidate.instructions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-[13.5px] text-ink-soft">– (von der Quelle nicht geliefert)</p>
      )}
    </Panel>
  );
}

function RawSourcePanel({ stored }: { stored: StoredImportCandidate }) {
  const { source, imageRef } = stored.candidate;
  return (
    <Panel title="Rohdaten der Quelle (unverändert)">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
        <dt className="text-ink-soft">Quelle</dt>
        <dd className="text-ink">
          {source.label} ({source.type})
        </dd>
        <dt className="text-ink-soft">Externe ID</dt>
        <dd className="num min-w-0 break-all text-ink">{source.externalId ?? "– (keine, daher keine Deduplizierung)"}</dd>
        <dt className="text-ink-soft">URL</dt>
        <dd className="min-w-0 break-all text-ink">{source.url ?? "–"}</dd>
        <dt className="text-ink-soft">Bildreferenz</dt>
        <dd className="min-w-0 break-all text-ink">{imageRef ?? "–"}</dd>
        <dt className="text-ink-soft">Importiert</dt>
        <dd className="text-ink">{formatReviewDate(stored.candidate.importedAt)}</dd>
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] font-medium text-ink-soft">Vollständige Rohdaten anzeigen</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-[var(--radius-sm)] bg-bg p-3 text-[12px] text-ink">{JSON.stringify(stored.rawPayload, null, 2)}</pre>
      </details>
    </Panel>
  );
}

function EventDetails({ event }: { event: ImportEventView }) {
  const details = (event.details ?? {}) as Record<string, unknown>;
  if (event.action === "publish_blocked" && Array.isArray(details.blockers)) {
    return (
      <ul className="mt-1 list-inside list-disc text-[12.5px] text-ink-soft">
        {(details.blockers as { message: string }[]).map((blocker, i) => (
          <li key={i}>{blocker.message}</li>
        ))}
      </ul>
    );
  }
  if (event.action === "food_assigned") {
    return (
      <p className="mt-1 text-[12.5px] text-ink-soft">
        „{String(details.originalText)}“ → {String(details.foodName)}
      </p>
    );
  }
  if (event.action === "published" && Array.isArray(details.tags)) {
    return (
      <p className="mt-1 text-[12.5px] text-ink-soft">
        Slug {String(details.slug)} · Tags {(details.tags as string[]).join(", ")}
      </p>
    );
  }
  if (event.action === "approved" && Array.isArray(details.acknowledgedDuplicateIds) && details.acknowledgedDuplicateIds.length > 0) {
    return <p className="mt-1 text-[12.5px] text-ink-soft">{details.acknowledgedDuplicateIds.length} mögliche(s) Duplikat(e) bewusst bestätigt</p>;
  }
  if (event.action === "publish_error") {
    return <p className="mt-1 text-[12.5px] text-danger">{String(details.code ?? "Fehler")} – vollständig zurückgerollt, kein Rezept erstellt</p>;
  }
  return null;
}

function HistoryPanel({ events }: { events: ImportEventView[] }) {
  return (
    <Panel title={`Verlauf (${events.length})`}>
      <ol className="flex flex-col gap-2.5">
        {events.map((event) => (
          <li key={event.id} className="text-[13.5px]">
            <p className="text-ink">
              <span className="font-semibold">{IMPORT_EVENT_LABELS[event.action] ?? event.action}</span>
              <span className="text-ink-soft">
                {" · "}
                {formatReviewDate(event.createdAt)}
                {event.fromStatus && event.fromStatus !== event.toStatus
                  ? ` · ${IMPORT_QUEUE_STATUS_LABELS[event.fromStatus]} → ${IMPORT_QUEUE_STATUS_LABELS[event.toStatus]}`
                  : ""}
                {` · ${event.actorName ?? (event.actorUserId ? "Reviewer" : "System")}`}
              </span>
            </p>
            {event.note && <p className="mt-0.5 text-[13px] text-ink-soft">„{event.note}“</p>}
            {event.recipeId && <p className="num mt-0.5 text-[12.5px] text-ink-soft">Recipe-ID: {event.recipeId}</p>}
            <EventDetails event={event} />
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/**
 * Detailansicht eines Import-Kandidaten (Kapitel 21). Die Bewertung wird bei jedem Aufruf frisch
 * gegen den aktuellen Katalog berechnet; Rohdaten und Interpretation stehen nebeneinander, nichts
 * wird überschrieben. Alle Aktionen laufen über Server Actions mit eigener Berechtigungsprüfung.
 */
export default async function ImportCandidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await requireInternalReviewAccess();
  const { id } = await params;
  const query = await searchParams;

  const detail = await getImportCandidateDetail(id);
  if (!detail) notFound();
  const context = await loadImportReviewContext();
  const { stored, events } = detail;
  const review = reviewStoredCandidate(stored, context);

  return (
    <div>
      <Link href="/internal/recipe-review" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-soft hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5" /> Zur Review-Seite
      </Link>

      <div className="mt-4">
        <SectionHeader
          eyebrow="Import-Kandidat"
          title={stored.candidate.name || "(kein Name)"}
          intro={`Quelle: ${stored.sourceProvider} · importiert ${formatReviewDate(stored.candidate.importedAt)}`}
        />
        <p className={`text-label mt-3 ${IMPORT_STATUS_TONE[stored.status]}`}>{IMPORT_QUEUE_STATUS_LABELS[stored.status]}</p>
        {stored.publishedRecipeId && <p className="num mt-1 text-[13px] text-ink-soft">Katalog-Rezept: {stored.publishedRecipeId}</p>}
      </div>

      <div className="mt-6 flex flex-col gap-6">
        <Notice query={query} />
        <ApprovalPanel stored={stored} review={review} />
        <ActionsPanel stored={stored} review={review} />
        <IngredientsPanel stored={stored} catalog={context.catalog} />
        <NutritionPanel review={review} />
        <FindingsPanels stored={stored} review={review} />
        <RecipeDataPanel stored={stored} />
        <RawSourcePanel stored={stored} />
        <HistoryPanel events={events} />
      </div>
    </div>
  );
}
