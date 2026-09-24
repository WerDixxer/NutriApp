import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { IMPORT_ERROR_MESSAGES } from "@/lib/labels";
import { buildRecipeCatalogQualityReport } from "@/lib/recipes/catalogQuality";
import { listImportQueue } from "@/lib/recipes/importQueueService";
import { isImportQueueStatus } from "@/lib/recipes/importWorkflow";
import { buildRecipeReviewQueue } from "@/lib/recipes/recipeReview";
import { loadCatalogQualityInputs, loadFoodCatalog } from "@/lib/recipes/recipeService";
import { requireInternalReviewAccess } from "@/lib/session";
import { ImportQueueSection } from "./ImportQueueSection";
import { ReviewQueueClient } from "./ReviewQueueClient";

// Liest den Katalog live bei jedem Aufruf (interne Diagnose-Seite, kein Cache gewünscht).
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function countParam(value: string | string[] | undefined): number | null {
  const text = single(value);
  return text !== null && /^\d{1,4}$/.test(text) ? Number(text) : null;
}

/** Meldung nach einer Aktion; nur feste Texte aus labels.ts, nie ungeprüfter Text aus der URL. */
function importNotice(params: Record<string, string | string[] | undefined>): { tone: "status" | "alert"; text: string } | null {
  const imported = countParam(params.imported);
  const skipped = countParam(params.skipped);
  if (imported !== null && skipped !== null) {
    return { tone: "status", text: `${imported} Kandidaten importiert, ${skipped} übersprungen (Quelle bereits in der Queue).` };
  }
  const error = single(params.importError);
  if (error) return { tone: "alert", text: IMPORT_ERROR_MESSAGES[error] ?? "Die Aktion konnte nicht ausgeführt werden." };
  return null;
}

/**
 * Interne Recipe-Review-Seite: persistente Import-Queue (Kapitel 21) und die Katalog-Review-Queue
 * (Kapitel 19, unverändert). Der Katalog wird EINMAL geladen und dient sowohl dem Kapitel-18-Report
 * als auch der Bewertung der Import-Kandidaten - kein zweiter Duplicate-Scan, kein zweiter Load.
 */
export default async function RecipeReviewPage({ searchParams }: { searchParams: SearchParams }) {
  await requireInternalReviewAccess();
  const params = await searchParams;
  const statusParam = single(params.importStatus);
  const importStatus = statusParam !== null && isImportQueueStatus(statusParam) ? statusParam : null;

  const [recipes, catalog] = await Promise.all([loadCatalogQualityInputs(), loadFoodCatalog()]);
  const report = buildRecipeCatalogQualityReport(recipes, catalog);
  const queue = buildRecipeReviewQueue(recipes, report);
  const importOverview = await listImportQueue({ catalog, existingRecipes: recipes }, importStatus);
  const { byCategory } = queue.summary;
  const notice = importNotice(params);

  return (
    <div>
      <SectionHeader
        eyebrow="Internes Werkzeug · nicht Teil des Produkts"
        title="Recipe Review"
        intro="Import-Queue mit Freigabe und kontrolliertem Publish, darunter die Qualitäts- und Duplikat-Prüfung des bestehenden Katalogs."
      />

      {notice && (
        <p
          role={notice.tone}
          className={`mt-6 rounded-[var(--radius-md)] px-4 py-3 text-[13.5px] font-medium ${notice.tone === "alert" ? "bg-bg-dim text-danger" : "bg-bg-dim text-ink"}`}
        >
          {notice.text}
        </p>
      )}

      <div className="mt-8">
        <ImportQueueSection overview={importOverview} activeStatus={importStatus} />
      </div>

      <section aria-labelledby="catalog-review-heading" className="mt-14">
        <h2 id="catalog-review-heading" className="text-h3 text-ink">
          Katalog-Review
        </h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          {`${queue.summary.total} Rezepte · ${byCategory.duplicate_exact} exakte Duplikate · ${byCategory.duplicate_possible} mögliche Duplikate · ${byCategory.quality_issue} Quality Issues · ${byCategory.insufficient_data} ohne strukturierte Daten · ${byCategory.clean} sauber. Status-Änderungen in dieser Liste sind rein lokal und werden beim Neuladen zurückgesetzt.`}
        </p>
        <div className="mt-5">
          {queue.items.length === 0 ? (
            <EmptyState title="Keine Rezepte im Katalog" description="Sobald Rezepte vorhanden sind, erscheinen sie hier." />
          ) : (
            <ReviewQueueClient items={queue.items} />
          )}
        </div>
      </section>
    </div>
  );
}
