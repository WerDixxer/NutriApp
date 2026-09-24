import { RecipeTypeTile } from "@/components/RecipeTypeIcon";
import { approxGrams, approxKcal } from "@/lib/format";
import type { CardHint, CatalogCard } from "@/lib/recipes/catalogBrowser";

/**
 * Drei Karten für den Rezeptkatalog, alle mit FESTEM Aufbau, damit Karten einer Reihe gleich
 * hoch sind (keine Masonry-Optik): Bereiche haben reservierte Mindesthöhen statt Inhaltshöhen.
 *  - StandardCard: normale Rezepte. Mobil eine Zeile (Icon links), ab `sm` eine hochformatige Karte.
 *  - FeaturedCard: "Für dich", größer, mit Kurzbeschreibung (mobil ohne, damit die Karte kompakt bleibt).
 *  - CompactCard: schnelle Gerichte, eine ruhige Zeile.
 * Die Reihenfolge folgt der Wichtigkeit: Typ-Icon, Name, Einordnung, Kerndaten, Hinweis.
 */

interface CardProps {
  card: CatalogCard;
  onOpen: (card: CatalogCard) => void;
}

const HINT_TONE: Record<CardHint["kind"], string> = {
  allergy: "text-danger",
  adapted: "text-primary",
  dislike: "text-warn",
  favorite: "text-primary",
};

const BUTTON_BASE =
  "text-left transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** "~360 kcal · ~26 g Protein · 15 Min." als Teile, damit sie als Ganzes umbrechen statt mittendrin. */
function facts(card: CatalogCard): string[] {
  return [approxKcal(card.kcal), `${approxGrams(card.proteinG)} Protein`, `${card.timeMin} Min.`];
}

function Facts({ card, className = "" }: { card: CatalogCard; className?: string }) {
  return (
    <span className={`num flex flex-wrap gap-x-2 text-[12.5px] leading-5 text-ink-soft ${className}`}>
      {facts(card).map((part, i) => (
        <span key={part} className="whitespace-nowrap">
          {i > 0 && <span aria-hidden="true" className="mr-2 text-ink-faint">·</span>}
          {part}
        </span>
      ))}
    </span>
  );
}

/** Eine feste Zeile für Hinweise (Präferenzen heute, "Für dich angepasst" später); ab `sm` leer, aber reserviert, damit Karten einer Reihe gleich hoch bleiben; mobil entfällt die leere Zeile. */
function HintLine({ hint, className = "" }: { hint: CardHint | null; className?: string }) {
  return (
    <span className={`block truncate text-[12px] font-medium leading-5 empty:hidden sm:min-h-5 sm:empty:block ${hint ? HINT_TONE[hint.kind] : ""} ${className}`} title={hint?.text}>
      {hint?.text}
    </span>
  );
}

export function StandardCard({ card, onOpen }: CardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className={`${BUTTON_BASE} flex h-full w-full items-start gap-3.5 rounded-[var(--radius-md)] border border-border bg-white p-4 hover:border-ink-faint sm:flex-col sm:gap-4 sm:p-5 ${
        card.flags.blockedByAllergy ? "opacity-75" : ""
      }`}
    >
      <RecipeTypeTile type={card.type.key} size="md" />
      <span className="flex min-w-0 flex-1 flex-col sm:w-full">
        <span className="text-balance text-[15.5px] font-semibold leading-snug text-ink sm:min-h-[2.75rem]">{card.name}</span>
        <span className="text-label mt-1.5 text-ink-faint">{card.type.label}</span>
        <Facts card={card} className="mt-2.5" />
        <HintLine hint={card.hint} className="mt-1.5 sm:mt-2" />
      </span>
    </button>
  );
}

export function FeaturedCard({ card, onOpen }: CardProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      className={`${BUTTON_BASE} flex h-full w-full flex-col gap-4 rounded-[var(--radius-md)] border border-border bg-bg-dim/60 p-5 hover:border-ink-faint sm:p-6`}
    >
      <span className="flex items-center gap-3">
        <RecipeTypeTile type={card.type.key} size="lg" />
        <span className="text-label text-ink-faint">{card.type.label}</span>
      </span>
      <span className="flex flex-1 flex-col">
        <span className="text-balance text-[19px] font-semibold leading-snug text-ink lg:min-h-[3.25rem]">{card.name}</span>
        <span className="mt-1.5 hidden text-[13.5px] leading-snug text-ink-soft sm:line-clamp-2 sm:block sm:min-h-[2.75rem]">{card.description}</span>
        <Facts card={card} className="mt-3" />
        <HintLine hint={card.hint} className="mt-2" />
      </span>
    </button>
  );
}

export function CompactCard({ card, onOpen }: CardProps) {
  const { hint } = card;
  return (
    <button
      type="button"
      onClick={() => onOpen(card)}
      title={hint?.text}
      className={`${BUTTON_BASE} flex h-full min-h-[4.5rem] w-full items-center gap-3 rounded-[var(--radius-md)] bg-bg-dim/70 px-3.5 py-3 hover:bg-bg-dim`}
    >
      <RecipeTypeTile type={card.type.key} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-balance text-[14.5px] font-semibold leading-snug text-ink">{card.name}</span>
        <Facts card={card} className="mt-0.5" />
      </span>
      {hint && (
        <>
          <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full bg-current ${HINT_TONE[hint.kind]}`} />
          <span className="sr-only">{hint.text}</span>
        </>
      )}
    </button>
  );
}
