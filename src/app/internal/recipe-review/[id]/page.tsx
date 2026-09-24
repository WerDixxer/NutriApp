import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { QUALITY_SEVERITY_LABELS, REVIEW_CATEGORY_LABELS, REVIEW_STATUS_LABELS } from "@/lib/labels";
import { buildRecipeCatalogQualityReport } from "@/lib/recipes/catalogQuality";
import { buildRecipeReviewQueue } from "@/lib/recipes/recipeReview";
import { loadCatalogQualityInputs, loadFoodCatalog } from "@/lib/recipes/recipeService";
import { requireInternalReviewAccess } from "@/lib/session";
import { DuplicateCandidateCard } from "../DuplicateCandidateCard";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, string> = { error: "text-danger", warning: "text-warn", info: "text-ink-faint" };

/**
 * Read-only Detailansicht eines Review-Eintrags (Kapitel 19, Abschnitt 4/5). Bewusst ohne
 * eigenen Status-Regler: die Queue-Seite trägt den lokalen UI-Status; diese Seite zeigt nur die
 * Daten, nachvollziehbar statt nur einen Score. Kein Schreibzugriff.
 */
export default async function RecipeReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireInternalReviewAccess();
  const { id } = await params;

  const [recipes, catalog] = await Promise.all([loadCatalogQualityInputs(), loadFoodCatalog()]);
  const report = buildRecipeCatalogQualityReport(recipes, catalog);
  const queue = buildRecipeReviewQueue(recipes, report);
  const item = queue.items.find((i) => i.recipeId === id);
  if (!item) notFound();

  return (
    <div>
      <Link href="/internal/recipe-review" className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-soft hover:text-ink">
        <ChevronLeft className="h-3.5 w-3.5" /> Zur Review-Queue
      </Link>

      <div className="mt-4">
        <SectionHeader eyebrow={REVIEW_CATEGORY_LABELS[item.category]} title={item.recipeName} intro={item.reviewReason} />
      </div>

      <div className="mt-8 flex flex-col gap-6">
        <Card className="p-5">
          <h2 className="text-label text-ink-faint">Rezeptdaten</h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
            <dt className="text-ink-soft">Recipe ID</dt>
            <dd className="num min-w-0 break-all text-ink">{item.recipeId}</dd>
            <dt className="text-ink-soft">Slug</dt>
            <dd className="text-ink">{item.slug ?? "– (kein Katalog-Rezept, Altbestand)"}</dd>
            <dt className="text-ink-soft">Status</dt>
            <dd className="text-ink">
              {REVIEW_STATUS_LABELS.pending}{" "}
              <span className="text-[12px] text-ink-faint">(nur lokal in der Übersicht änderbar, keine Persistenz)</span>
            </dd>
          </dl>
        </Card>

        {item.qualityIssues.length > 0 && (
          <Card className="p-5">
            <h2 className="text-label text-ink-faint">Quality Issues ({item.qualityIssues.length})</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {item.qualityIssues.map((issue, i) => (
                <li key={i} className="text-[13.5px] text-ink">
                  <span className={`text-label ${SEVERITY_TONE[issue.severity]}`}>{QUALITY_SEVERITY_LABELS[issue.severity]}</span>{" "}
                  <span className="text-ink-soft">{issue.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {item.duplicateCandidates.length > 0 && (
          <Card className="p-5">
            <h2 className="text-label text-ink-faint">Duplicate-Kandidaten ({item.duplicateCandidates.length})</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {item.duplicateCandidates.map((candidate) => (
                <DuplicateCandidateCard key={`${candidate.kind}-${candidate.recipe.id}`} recipeName={item.recipeName} candidate={candidate} />
              ))}
            </ul>
          </Card>
        )}

        {item.category === "clean" && (
          <Card className="p-5">
            <p className="text-[13.5px] text-ink-soft">Keine Quality Issues und keine Duplicate-Kandidaten gefunden. Grundsätzlich review-fähig.</p>
          </Card>
        )}
      </div>
    </div>
  );
}
