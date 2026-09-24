"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import { RecipeDetailDialog } from "@/components/RecipeDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { Pill } from "@/components/ui/Pill";
import {
  activeFilterCount,
  catalogQueryToSearchParams,
  isFilterActive,
  toggleFilter,
  type CatalogCard,
  type CatalogQuery,
  type DiscoverSection,
  type FilterToggle,
} from "@/lib/recipes/catalogBrowser";
import { CompactCard, FeaturedCard, StandardCard } from "./RecipeCards";

const PAGE_SIZE = 24;

const MEAL_CHIPS: { label: string; toggle: FilterToggle }[] = [
  { label: "Frühstück", toggle: { kind: "meal", value: "BREAKFAST" } },
  { label: "Mittag", toggle: { kind: "meal", value: "LUNCH" } },
  { label: "Abend", toggle: { kind: "meal", value: "DINNER" } },
  { label: "Snack", toggle: { kind: "meal", value: "SNACK" } },
  { label: "Vor dem Training", toggle: { kind: "meal", value: "PRE_WORKOUT" } },
  { label: "Nach dem Training", toggle: { kind: "meal", value: "POST_WORKOUT" } },
];

const MORE_FILTERS: { title: string; chips: { label: string; toggle: FilterToggle }[] }[] = [
  {
    title: "Ernährung",
    chips: [
      { label: "Vegetarisch", toggle: { kind: "diet", value: "vegetarian" } },
      { label: "Vegan", toggle: { kind: "diet", value: "vegan" } },
      { label: "Pescetarisch", toggle: { kind: "diet", value: "pescatarian" } },
    ],
  },
  {
    title: "Ziel",
    chips: [
      { label: "Proteinreich", toggle: { kind: "goal", value: "high-protein" } },
      { label: "Kalorienarm", toggle: { kind: "goal", value: "low-calorie" } },
      { label: "Low Carb", toggle: { kind: "goal", value: "low-carb" } },
      { label: "Ballaststoffreich", toggle: { kind: "goal", value: "high-fiber" } },
    ],
  },
  {
    title: "Training",
    chips: [
      { label: "Fußball", toggle: { kind: "sport", value: "football" } },
      { label: "Kraft", toggle: { kind: "sport", value: "strength" } },
      { label: "Cardio", toggle: { kind: "sport", value: "cardio" } },
    ],
  },
  {
    title: "Praktisch",
    chips: [
      { label: "Schnell (bis 20 Min.)", toggle: { kind: "flag", value: "quick" } },
      { label: "Meal Prep", toggle: { kind: "flag", value: "meal-prep" } },
      { label: "Günstig", toggle: { kind: "flag", value: "budget-friendly" } },
    ],
  },
];

function hasMoreFilter(query: CatalogQuery): boolean {
  return MORE_FILTERS.some((group) => group.chips.some((c) => isFilterActive(query.filter, c.toggle)));
}

/** Eigene Komponente, damit die Anzahl sichtbarer Karten bei jeder neuen Anfrage neu beginnt (Aufrufer setzt `key`). */
function Results({ cards, onOpen }: { cards: CatalogCard[]; onOpen: (card: CatalogCard) => void }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const shown = cards.slice(0, visible);
  return (
    <>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((card) => (
          <li key={card.id}>
            <StandardCard card={card} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {cards.length > shown.length && (
        <div className="mt-6 flex justify-center">
          <Pill onClick={() => setVisible((v) => v + PAGE_SIZE)}>Mehr anzeigen ({cards.length - shown.length} weitere)</Pill>
        </div>
      )}
    </>
  );
}

const SECTION_GRID: Record<DiscoverSection["variant"], string> = {
  featured: "grid grid-cols-1 gap-3 lg:grid-cols-3",
  standard: "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
  compact: "grid grid-cols-1 gap-3 sm:grid-cols-2",
};

/** Standardansicht ohne Suche und Filter: Bereiche mit wenigen Karten; der Rest steckt hinter "Alle anzeigen" (bestehender Filter). */
function Sections({
  sections,
  onOpen,
  onMore,
}: {
  sections: DiscoverSection[];
  onOpen: (card: CatalogCard) => void;
  onMore: (query: CatalogQuery) => void;
}) {
  return (
    <div className="flex flex-col gap-10">
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`section-${section.id}`}>
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 id={`section-${section.id}`} className="text-h3 text-ink">
              {section.title}
            </h2>
            {section.more && (
              <button
                type="button"
                onClick={() => onMore(section.more!)}
                className="shrink-0 text-[13px] font-medium text-ink-soft underline underline-offset-2 hover:text-primary"
              >
                Alle anzeigen ({section.total})
              </button>
            )}
          </div>
          <ul className={SECTION_GRID[section.variant]}>
            {section.cards.map((card, i) => (
              // Standardkarten: mobil nur die ersten drei, damit die Seite nicht endlos lang wird.
              <li key={card.id} className={section.variant === "standard" && i >= 3 ? "hidden sm:block" : undefined}>
                {section.variant === "featured" ? (
                  <FeaturedCard card={card} onOpen={onOpen} />
                ) : section.variant === "compact" ? (
                  <CompactCard card={card} onOpen={onOpen} />
                ) : (
                  <StandardCard card={card} onOpen={onOpen} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
export default function CatalogBrowser({
  query,
  cards,
  sections,
  resultCount,
  blockedCount,
  catalogSize,
}: {
  query: CatalogQuery;
  /** Trefferliste bei Suche/Filtern; in der Standardansicht leer. */
  cards: CatalogCard[];
  /** Gesetzt = Standardansicht (ohne Suche und Filter) in Bereichen. */
  sections: DiscoverSection[] | null;
  resultCount: number;
  blockedCount: number;
  catalogSize: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.q);
  const [moreOpen, setMoreOpen] = useState(() => hasMoreFilter(query));
  const [open, setOpen] = useState<CatalogCard | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function navigate(next: CatalogQuery) {
    const qs = catalogQueryToSearchParams(next).toString();
    startTransition(() => router.replace(qs ? `/recipes?${qs}` : "/recipes", { scroll: false }));
  }

  function onSearchChange(value: string) {
    setSearch(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => navigate({ ...query, q: value }), 300);
  }

  function reset() {
    clearTimeout(timer.current);
    setSearch("");
    navigate({ q: "", filter: {}, showBlocked: false });
  }

  const filterCount = activeFilterCount(query.filter);
  const hasQuery = query.q.trim() !== "" || filterCount > 0;

  function chip(label: string, toggle: FilterToggle) {
    const active = isFilterActive(query.filter, toggle);
    return (
      <Pill key={label} active={active} aria-pressed={active} onClick={() => navigate(toggleFilter(query, toggle))}>
        {label}
      </Pill>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4">
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            clearTimeout(timer.current);
            navigate({ ...query, q: search });
          }}
          className="relative"
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Rezept oder Zutat suchen"
            aria-label="Rezepte durchsuchen"
            className="w-full rounded-full border border-border bg-bg-dim py-2.5 pl-10 pr-4 text-[14.5px] text-ink outline-none transition-colors duration-[var(--duration-fast)] placeholder:text-ink-faint focus:border-ink focus:bg-bg"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mahlzeit">
          {MEAL_CHIPS.map((c) => chip(c.label, c.toggle))}
        </div>

        {moreOpen && (
          <div className="flex flex-col gap-3 rounded-[var(--radius-md)] bg-bg-dim/60 p-4">
            {MORE_FILTERS.map((group) => (
              <div key={group.title} role="group" aria-label={group.title} className="flex flex-wrap items-center gap-2">
                <span className="text-label w-24 shrink-0 text-ink-faint">{group.title}</span>
                {group.chips.map((c) => chip(c.label, c.toggle))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-ink-soft">
        <span aria-live="polite">{sections ? `${resultCount} Rezepte` : `${resultCount} von ${catalogSize} Rezepten`}</span>
        <span className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className="inline-flex items-center gap-1 font-medium transition-colors duration-[var(--duration-fast)] hover:text-ink"
          >
            Weitere Filter
            <ChevronDown className={`h-4 w-4 transition-transform duration-[var(--duration-fast)] ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {hasQuery && (
            <button type="button" onClick={reset} className="font-medium underline underline-offset-2 hover:text-primary">
              Zurücksetzen
            </button>
          )}
        </span>
      </div>

      {blockedCount > 0 && (
        <p className="rounded-[var(--radius-md)] bg-danger-soft px-4 py-3 text-[13px] text-danger">
          {query.showBlocked
            ? `${blockedCount} ${blockedCount === 1 ? "Rezept enthält" : "Rezepte enthalten"} Allergene aus deinem Profil und ${blockedCount === 1 ? "ist" : "sind"} markiert. `
            : `${blockedCount} ${blockedCount === 1 ? "Rezept wird" : "Rezepte werden"} wegen deiner Allergien nicht angezeigt. `}
          <button
            type="button"
            onClick={() => navigate({ ...query, showBlocked: !query.showBlocked })}
            className="font-semibold underline underline-offset-2"
          >
            {query.showBlocked ? "Wieder ausblenden" : "Trotzdem anzeigen"}
          </button>
        </p>
      )}

      <div aria-busy={pending} className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {sections ? (
          <Sections sections={sections} onOpen={setOpen} onMore={navigate} />
        ) : cards.length === 0 ? (
          <EmptyState
            title="Keine Rezepte gefunden"
            description="Ändere die Suche oder nimm einen Filter heraus."
          />
        ) : (
          <Results key={catalogQueryToSearchParams(query).toString()} cards={cards} onOpen={setOpen} />
        )}
      </div>

      <RecipeDetailDialog recipe={open?.detail ?? null} onClose={() => setOpen(null)} />
    </div>
  );
}
