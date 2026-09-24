import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { IMPORT_STATUS_LABELS, QUALITY_SEVERITY_LABELS, REVIEW_CATEGORY_LABELS } from "@/lib/labels";
import { IMPORT_FIXTURES } from "@/lib/recipes/data/importFixtures";
import { loadCatalogQualityInputs, loadFoodCatalog } from "@/lib/recipes/recipeService";
import { formatNormalizedIngredient, runImportPipeline, toRecipeReviewItem, type ImportStatus } from "@/lib/recipes/recipeImport";
import { requireInternalReviewAccess } from "@/lib/session";
import { DuplicateCandidateCard } from "../DuplicateCandidateCard";
import { enqueueMockFixturesAction } from "../imports/actions";
import { SubmitButton } from "../imports/SubmitButton";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ImportStatus, string> = {
  raw: "text-ink-faint",
  normalized: "text-ink-faint",
  validation_failed: "text-danger",
  ready_for_review: "text-primary",
  duplicate_review: "text-warn",
  approved: "text-primary",
  rejected: "text-danger",
};

const RESOLUTION_TONE: Record<string, string> = { resolved: "text-ink-soft", unresolved: "text-warn" };

/**
 * Read-only Vorschau der Import-Pipeline (Kapitel 20) anhand der festen Mock-Fixtures A-E
 * (`data/importFixtures.ts`) - kein Netzwerk, keine echte externe Quelle, kein Schreibzugriff.
 * Zeigt für jede Fixture, was die Pipeline JETZT liefert: normalisierte Zutaten, Validation-
 * Befunde, Duplicate-Kandidaten gegen den ECHTEN Katalog, Quality Issues - genau dieselben
 * Bausteine wie die Review-Queue für echte Katalog-Rezepte, wiederverwendet statt verdoppelt.
 * Es entsteht dabei NIE ein neues Recipe im Katalog: `runImportPipeline` schreibt nichts. Nur der
 * explizite Button übernimmt die Fixtures über eine eigene Server Action in die Import-Queue
 * (Kapitel 21) - als zu prüfende Kandidaten, nicht als Rezepte.
 */
export default async function ImportPreviewPage() {
  await requireInternalReviewAccess();

  const [existingRecipes, catalog] = await Promise.all([loadCatalogQualityInputs(), loadFoodCatalog()]);
  const results = IMPORT_FIXTURES.map((fixture) => ({
    fixture,
    result: runImportPipeline(fixture, catalog, existingRecipes),
  }));

  return (
    <div>
      <Link href="/internal/recipe-review" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-soft hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5" /> Zur Review-Queue
      </Link>

      <div className="mt-4">
        <SectionHeader
          eyebrow="Internes Werkzeug · nicht Teil des Produkts"
          title="Import-Pipeline (Vorschau)"
          intro="Feste Mock-Fixtures durch die vollständige Import-Pipeline: Normalisierung, Food-Auflösung, Validierung, Duplicate-Check gegen den echten Katalog. Diese Vorschau selbst schreibt nichts – es wird nie ein Rezept angelegt, verändert oder gelöscht."
        />
      </div>

      <form action={enqueueMockFixturesAction} className="mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] bg-bg-dim p-4">
        <p className="min-w-0 flex-1 text-[13px] text-ink-soft">
          Übernimmt diese Fixtures als Kandidaten in die Import-Queue (Status „Wartet auf Prüfung“). Bereits vorhandene Quellen-IDs werden übersprungen. Es entsteht dabei kein Katalog-Rezept.
        </p>
        <SubmitButton variant="secondary" pendingLabel="Wird übernommen …">
          In die Import-Queue übernehmen
        </SubmitButton>
      </form>

      <div className="mt-8 flex flex-col gap-6">
        {results.map(({ fixture, result }) => {
          const reviewItem = toRecipeReviewItem(result);
          return (
            <Card key={result.candidate.source.externalId ?? result.candidate.name} className="flex flex-col gap-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-ink">{result.candidate.name}</p>
                  <p className="mt-0.5 text-[13px] text-ink-soft">
                    Quelle: {fixture.source.label} ({fixture.source.type}
                    {fixture.source.externalId ? `, ${fixture.source.externalId}` : ""})
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className={`text-label ${STATUS_TONE[result.status]}`}>{IMPORT_STATUS_LABELS[result.status]}</span>
                  <span className="text-[12px] text-ink-faint">{REVIEW_CATEGORY_LABELS[reviewItem.category]}</span>
                </div>
              </div>

              <div>
                <h3 className="text-label text-ink-faint">Normalisierte Zutaten ({result.candidate.ingredients.length})</h3>
                <ul className="mt-2 flex flex-col gap-1">
                  {result.candidate.ingredients.map((ingredient, i) => (
                    <li key={i} className="text-[13.5px] text-ink">
                      <span className={RESOLUTION_TONE[ingredient.resolutionStatus]}>
                        {ingredient.resolutionStatus === "resolved" ? formatNormalizedIngredient(ingredient) : `Nicht zugeordnet: "${ingredient.originalText}"`}
                      </span>
                      {ingredient.resolutionStatus === "resolved" && ingredient.amount === null && (
                        <span className="ml-1.5 text-[12px] text-warn">(Menge/Einheit unbekannt)</span>
                      )}
                      <span className="ml-1.5 text-[12px] text-ink-faint">Original: „{ingredient.originalText}“</span>
                    </li>
                  ))}
                </ul>
              </div>

              {result.validationIssues.length > 0 && (
                <div>
                  <h3 className="text-label text-ink-faint">Validation-Befunde ({result.validationIssues.length})</h3>
                  <ul className="mt-2 flex flex-col gap-1">
                    {result.validationIssues.map((issue, i) => (
                      <li key={i} className="text-[13.5px] text-ink">
                        <span className={`text-label ${issue.severity === "error" ? "text-danger" : "text-warn"}`}>
                          {issue.severity === "error" ? "Fehler" : "Warnung"}
                        </span>{" "}
                        <span className="text-ink-soft">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.catalogQualityIssues.length > 0 && (
                <div>
                  <h3 className="text-label text-ink-faint">Quality Issues ({result.catalogQualityIssues.length})</h3>
                  <ul className="mt-2 flex flex-col gap-1">
                    {result.catalogQualityIssues.map((issue, i) => (
                      <li key={i} className="text-[13.5px] text-ink">
                        <span className="text-label text-ink-faint">{QUALITY_SEVERITY_LABELS[issue.severity]}</span>{" "}
                        <span className="text-ink-soft">{issue.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {reviewItem.duplicateCandidates.length > 0 && (
                <div>
                  <h3 className="text-label text-ink-faint">Duplicate-Kandidaten ({reviewItem.duplicateCandidates.length})</h3>
                  <ul className="mt-2 flex flex-col gap-3">
                    {reviewItem.duplicateCandidates.map((candidate) => (
                      <DuplicateCandidateCard key={`${candidate.kind}-${candidate.recipe.id}`} recipeName={result.candidate.name} candidate={candidate} />
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-[12px] text-ink-faint">
                Nährwerte: {result.nutrition.nutrition.complete ? "vollständig" : `unvollständig (${result.nutrition.unresolvedIngredientCount} Zutat(en) ohne Beitrag)`}
                {" · "}Ernährungsform: {result.profile.dietClass ?? "nicht bestimmbar (mindestens eine Zutat nicht aufgelöst)"}
              </p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
