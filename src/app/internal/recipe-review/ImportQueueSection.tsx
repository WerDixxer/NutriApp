import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IMPORT_QUEUE_STATUS_LABELS } from "@/lib/labels";
import type { ImportQueueListItem, ImportQueueOverview } from "@/lib/recipes/importQueueService";
import { IMPORT_QUEUE_STATUSES, type ImportQueueStatus } from "@/lib/recipes/importWorkflow";
import { formatReviewDate, IMPORT_STATUS_TONE } from "./imports/display";

const QUEUE_PATH = "/internal/recipe-review";
/** Nur in diesen Status ist "freigabefähig oder nicht" eine offene Frage. */
const OPEN_STATUSES: readonly ImportQueueStatus[] = ["pending_review", "needs_changes", "failed"];

function FilterLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-semibold transition-colors duration-[var(--duration-fast)] ${
        active ? "bg-ink text-white" : "bg-bg-dim text-ink-soft hover:bg-bg-dim-hover"
      }`}
    >
      {children}
    </Link>
  );
}

function Finding({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <li className={`text-[12.5px] ${tone}`}>{children}</li>;
}

function ImportQueueCard({ item }: { item: ImportQueueListItem }) {
  const hasFindings =
    item.unresolvedFoods.length + item.missingNutrition.length + item.exactDuplicateNames.length + item.possibleDuplicateNames.length > 0;
  return (
    <Card className="flex flex-col gap-2.5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`${QUEUE_PATH}/imports/${item.id}`} className="text-[15px] font-semibold text-ink hover:underline">
            {item.name}
          </Link>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">
            {item.sourceProvider} ({item.sourceType}) · importiert {formatReviewDate(item.importedAt)} · {item.ingredientCount} Zutaten
            {item.qualityIssueCount > 0 && ` · ${item.qualityIssueCount} ${item.qualityIssueCount === 1 ? "Quality Issue" : "Quality Issues"}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-0.5 sm:items-end">
          <span className={`text-label ${IMPORT_STATUS_TONE[item.status]}`}>{IMPORT_QUEUE_STATUS_LABELS[item.status]}</span>
          {OPEN_STATUSES.includes(item.status) && (
            <span className={`text-[12px] ${item.approvable ? "text-primary" : "text-warn"}`}>
              {item.approvable ? "Freigabefähig" : `Nicht freigabefähig (${item.blockerCount} ${item.blockerCount === 1 ? "Grund" : "Gründe"})`}
            </span>
          )}
        </div>
      </div>
      {hasFindings && (
        <ul className="flex flex-col gap-0.5">
          {item.unresolvedFoods.length > 0 && <Finding tone="text-warn">Nicht zugeordnet: {item.unresolvedFoods.join(", ")}</Finding>}
          {item.missingNutrition.length > 0 && <Finding tone="text-warn">Nährwerte fehlen: {item.missingNutrition.join(", ")}</Finding>}
          {item.exactDuplicateNames.length > 0 && <Finding tone="text-danger">Exaktes Duplikat von: {item.exactDuplicateNames.join(", ")}</Finding>}
          {item.possibleDuplicateNames.length > 0 && (
            <Finding tone="text-warn">Mögliches Duplikat von: {item.possibleDuplicateNames.join(", ")}</Finding>
          )}
        </ul>
      )}
    </Card>
  );
}

/**
 * Import-Queue-Abschnitt der bestehenden Review-Seite (Kapitel 21). Rein lesend; Aktionen gibt es
 * nur auf der Detailseite. Der Statusfilter ist ein Link (`?importStatus=`), kein Client-State.
 */
export function ImportQueueSection({ overview, activeStatus }: { overview: ImportQueueOverview; activeStatus: ImportQueueStatus | null }) {
  return (
    <section aria-labelledby="import-queue-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="import-queue-heading" className="text-h3 text-ink">
          Import-Queue
        </h2>
        <Link href={`${QUEUE_PATH}/import-preview`} className="text-[13px] font-medium text-ink-soft hover:text-ink hover:underline">
          Import-Vorschau & Mock-Fixtures →
        </Link>
      </div>
      <p className="text-[13px] text-ink-soft">
        Extern importierte Rezepte. Nichts davon ist im Katalog, bis ein freigegebener Kandidat ausdrücklich veröffentlicht wird.
      </p>

      <nav aria-label="Import-Status filtern" className="flex flex-wrap gap-1.5">
        <FilterLink href={QUEUE_PATH} active={activeStatus === null}>
          Alle ({overview.total})
        </FilterLink>
        {IMPORT_QUEUE_STATUSES.map((status) => (
          <FilterLink key={status} href={`${QUEUE_PATH}?importStatus=${status}`} active={activeStatus === status}>
            {IMPORT_QUEUE_STATUS_LABELS[status]} ({overview.countsByStatus[status]})
          </FilterLink>
        ))}
      </nav>

      {overview.items.length === 0 ? (
        <EmptyState
          title={overview.total === 0 ? "Noch keine Import-Kandidaten" : "Keine Kandidaten in diesem Status"}
          description={overview.total === 0 ? "Über die Import-Vorschau lassen sich die Mock-Fixtures in die Queue übernehmen." : undefined}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {overview.items.map((item) => (
            <li key={item.id}>
              <ImportQueueCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
