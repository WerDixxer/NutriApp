"use client";

import { useCallback, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight, ShoppingBasket, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useDialogBehavior } from "@/components/ui/useDialogBehavior";
import {
  buildShoppingView,
  type ShoppingBuyRow,
  type ShoppingCoveredRow,
  type ShoppingPayload,
  type ShoppingUnresolvedRow,
  type ShoppingView,
} from "@/lib/shopping/shoppingView";

type LoadState = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; view: ShoppingView };

/** Ab sm (640px) gleitet das Panel von rechts herein, darunter steigt es von unten auf. */
const DESKTOP_QUERY = "(min-width: 640px)";

function subscribeToDesktop(onChange: () => void) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function SectionTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <h3 className="text-label flex items-baseline justify-between text-ink-faint">
      <span>{children}</span>
      <span className="num">{count}</span>
    </h3>
  );
}

function BuyRow({ row }: { row: ShoppingBuyRow }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[14.5px] font-medium leading-snug text-ink">{row.name}</p>
        {(row.pantryDetail || row.recipesLabel || row.unitNote) && (
          <p className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] leading-snug text-ink-soft">
            {row.pantryDetail && <span>{row.pantryDetail}</span>}
            {row.recipesLabel && <span>{row.recipesLabel}</span>}
            {row.unitNote && <span>{row.unitNote}</span>}
          </p>
        )}
      </div>
      <span className="num shrink-0 text-right text-[15px] font-semibold text-ink">{row.buy}</span>
    </li>
  );
}

function CoveredRow({ row }: { row: ShoppingCoveredRow }) {
  return (
    <li className="py-2.5">
      <p className="text-[14px] leading-snug text-ink">{row.name}</p>
      <p className="mt-0.5 text-[12px] leading-snug text-ink-soft">{row.detail}</p>
    </li>
  );
}

function UnresolvedRow({ row }: { row: ShoppingUnresolvedRow }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-2.5">
      <p className="min-w-0 text-[14px] leading-snug text-ink">{row.raw}</p>
      <span className="shrink-0 text-[12px] text-ink-soft">{row.mealsLabel}</span>
    </li>
  );
}

function ShoppingContent({ view }: { view: ShoppingView }) {
  if (view.status === "no-plan") {
    return (
      <EmptyState
        title="Noch kein Plan"
        description="Für diese Woche gibt es noch keinen Wochenplan, deshalb kann noch nichts berechnet werden."
      />
    );
  }
  if (view.status === "empty") {
    return (
      <EmptyState title="Keine Zutaten gefunden" description="Für die geplanten Mahlzeiten liegen keine Zutaten vor." />
    );
  }
  if (view.status === "all-covered") {
    return <EmptyState title="Alles vorhanden" description="Für diese Woche fehlen keine Zutaten." />;
  }

  return (
    <div className="flex flex-col gap-8">
      {view.partialWeekNote && <p className="text-[12.5px] text-ink-soft">{view.partialWeekNote}</p>}

      <section aria-label="Zu besorgen">
        <SectionTitle count={view.toBuy.length}>Zu besorgen</SectionTitle>
        {view.toBuy.length > 0 ? (
          <ul className="mt-1 divide-y divide-border">
            {view.toBuy.map((row) => (
              <BuyRow key={row.key} row={row} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[13.5px] leading-snug text-ink-soft">Für alle berechneten Zutaten ist genug im Vorrat.</p>
        )}
      </section>

      {view.covered.length > 0 && (
        <details className="group">
          <summary className="text-label flex cursor-pointer list-none items-center justify-between text-ink-faint [&::-webkit-details-marker]:hidden">
            <span>Schon vorhanden</span>
            <span className="flex items-center gap-2">
              <span className="num">{view.covered.length}</span>
              <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform duration-[var(--duration-base)] group-open:rotate-180" />
            </span>
          </summary>
          <ul className="mt-1 divide-y divide-border">
            {view.covered.map((row) => (
              <CoveredRow key={row.key} row={row} />
            ))}
          </ul>
        </details>
      )}

      {view.unresolved.length > 0 && (
        <section aria-label="Ohne Mengenangabe">
          <SectionTitle count={view.unresolved.length}>Ohne Mengenangabe</SectionTitle>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-soft">Menge konnte nicht eindeutig ermittelt werden.</p>
          <ul className="mt-1 divide-y divide-border">
            {view.unresolved.map((row) => (
              <UnresolvedRow key={row.key} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Der Einstieg "Wocheneinkauf" und das Panel dazu. Die Liste kommt aus dem
 * bestehenden /api/shopping/week und wird erst beim Öffnen geladen. Das Panel
 * ist ein Dialog: rechts eingeschoben ab 640px, darunter ein Bottom-Sheet.
 */
export default function WeeklyShoppingSheet({ weekStart, rangeLabel }: { weekStart: string; rangeLabel: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ status: "idle" });
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);

  // Portal braucht `document.body`: erst nach Hydration rendern (Server-Snapshot false).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const wide = useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );

  const close = useCallback(() => setOpen(false), []);
  useDialogBehavior({ open, onClose: close, panelRef, initialFocusRef: closeButtonRef, returnFocusRef: triggerRef, lockScroll: true });

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/shopping/week?date=${encodeURIComponent(weekStart)}`, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { shopping?: ShoppingPayload };
      if (!json.shopping || !Array.isArray(json.shopping.items) || !Array.isArray(json.shopping.unresolvedIngredients)) {
        throw new Error("Unerwartete Antwort");
      }
      if (id === requestId.current) setState({ status: "ready", view: buildShoppingView(json.shopping) });
    } catch {
      if (id === requestId.current) setState({ status: "error" });
    }
  }, [weekStart]);

  const openSheet = useCallback(() => {
    setOpen(true);
    void load();
  }, [load]);

  const hidden = wide ? { x: 32, opacity: 0 } : { y: 48, opacity: 0 };

  // Overlay und Panel sind Geschwister, nicht verschachtelt: ein Vorfahre mit
  // animierter Deckkraft würde die Hintergrundunschärfe des Panels abschalten.
  // Die Fläche ist zu 95 % deckend, damit die Liste auch ohne Unschärfe lesbar bleibt.
  const sheet = (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-50 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={close}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="shadow-lift fixed inset-x-0 bottom-0 z-50 flex border-border bg-bg/95 backdrop-blur-xl max-h-[88dvh] flex-col rounded-t-[var(--radius-lg)] border-t sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[26rem] sm:rounded-none sm:border-l sm:border-t-0"
            initial={hidden}
            animate={{ x: 0, y: 0, opacity: 1 }}
            exit={hidden}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 pb-4 pt-5 sm:px-6 sm:pt-6">
              <div className="min-w-0">
                <h2 id={titleId} className="text-h2 text-ink">
                  Wocheneinkauf
                </h2>
                <p className="num mt-1 text-[13px] text-ink-soft">{rangeLabel}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={close}
                aria-label="Schließen"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-white/70 text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-5 sm:px-6"
              style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 0px))" }}
            >
              {state.status === "loading" && (
                <p role="status" className="py-6 text-[13.5px] text-ink-soft">
                  Einkaufsliste wird berechnet.
                </p>
              )}
              {state.status === "error" && (
                <div role="alert" className="flex flex-col items-start gap-4 py-6">
                  <p className="text-[13.5px] leading-snug text-ink-soft">Die Einkaufsliste konnte nicht geladen werden.</p>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
                    Erneut versuchen
                  </Button>
                </div>
              )}
              {state.status === "ready" && <ShoppingContent view={state.view} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <>
      <Button ref={triggerRef} type="button" size="sm" variant="secondary" aria-haspopup="dialog" onClick={openSheet}>
        <ShoppingBasket className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
        Wocheneinkauf
        <ChevronRight className="-mr-1 h-4 w-4 text-ink-faint" aria-hidden="true" />
      </Button>
      {mounted && createPortal(sheet, document.body)}
    </>
  );
}
