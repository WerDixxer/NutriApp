"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChefHat, Clock, Flame, TrendingUp, Users, X } from "lucide-react";
import { approxGrams, approxKcal } from "@/lib/format";
import { useDialogBehavior } from "@/components/ui/useDialogBehavior";

export interface RecipeDetail {
  id: string;
  name: string;
  description: string;
  imageQuery: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  prepTimeMin: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  isTrending: boolean;
  trendSource: string | null;
  /** Falls die Portion für ein Tagesziel skaliert wurde (1 = Originalrezept). */
  portionMultiplier?: number;
  tags?: string[];
  /** Gesetzt, wenn Zutaten durch Lieblingslebensmittel des Nutzers ersetzt wurden. */
  personalization?: { swaps: { from: string; to: string }[] };
}

/**
 * Kein Food-Emoji, kein Icon-Set-Import: eine ruhige, markenfarbene Kachel
 * mit dem Anfangsbuchstaben des Gerichts. Vermeidet literale
 * Essens-Illustrationen (Pfanne/Ei/Burger/...), die die App wie eine
 * generische Meal-Planning-App wirken lassen - siehe Kapitel-Vorgabe.
 * Tonwahl deterministisch (Hash über den Namen), aber ausschließlich aus
 * den bestehenden, gedeckten Design-Tokens - kein Regenbogen-Pastell.
 */
const THUMB_TONES = [
  "var(--color-primary-soft)",
  "var(--color-warn-soft)",
  "var(--color-danger-soft)",
  "var(--color-accent-soft)",
  "var(--color-bg-dim)",
];

function toneFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return THUMB_TONES[hash % THUMB_TONES.length];
}

function MacroChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="flex items-center gap-1.5 font-display text-xl font-bold text-ink">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
        {approxGrams(value)}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</span>
    </div>
  );
}

export function RecipeThumb({ recipe, className = "" }: { recipe: RecipeDetail; className?: string }) {
  const initial = recipe.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      className={`font-display flex items-center justify-center rounded-lg text-ink ${className}`}
      style={{ background: toneFor(recipe.name) }}
    >
      {initial}
    </div>
  );
}

/**
 * Die Dialog-Fläche selbst, gesteuert von außen: `recipe` gesetzt = offen,
 * `null` = geschlossen. So kann eine Liste mit vielen Mahlzeiten EINEN Dialog
 * teilen, statt für jede Zeile eine eigene Instanz einzuhängen. Escape,
 * Fokusfalle, Fokus-Rückgabe und das Bottom-Sheet/Dialog-Verhalten sind
 * dieselben wie zuvor in RecipeDetailModal.
 *
 * `returnFocusRef`: Element, das beim Schließen den Fokus zurückbekommt (z.B.
 * die angeklickte Zeile, manche Browser fokussieren Buttons beim Klick nicht).
 * Ohne Angabe geht der Fokus an das Element zurück, das beim Öffnen fokussiert war.
 */
export function RecipeDetailDialog({
  recipe,
  onClose,
  returnFocusRef,
}: {
  recipe: RecipeDetail | null;
  onClose: () => void;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const open = recipe !== null;
  const [mounted, setMounted] = useState(false);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Portal braucht `document.body`, das während SSR nicht existiert. Flag wird
  // erst nach dem Hydration-Mount gesetzt, um einen Markup-Mismatch zu vermeiden.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Escape, Fokusfalle und Fokus-Rückgabe: gemeinsam mit dem Wocheneinkauf-Sheet.
  useDialogBehavior({ open, onClose, panelRef, initialFocusRef: closeButtonRef, returnFocusRef });

  const modal = (
      <AnimatePresence>
        {recipe && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          >
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-lg)] border border-border bg-white sm:rounded-[var(--radius-lg)] sm:shadow-hard"
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", damping: 26, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="relative flex h-28 items-center justify-center border-b border-border"
                style={{ background: toneFor(recipe.name) }}
              >
                <span className="font-display text-4xl text-ink/70">{recipe.name.trim().charAt(0).toUpperCase()}</span>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  aria-label="Schließen"
                  className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
                {recipe.isTrending && (
                  <span className="absolute left-4 top-4 flex items-center gap-1 rounded-full border border-accent/30 bg-white px-2.5 py-1 text-xs font-semibold text-accent">
                    <TrendingUp className="h-3 w-3" /> Trend
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-5 p-6">
                <div>
                  <h2 id={titleId} className="font-display text-2xl font-bold text-ink">{recipe.name}</h2>
                  <p className="mt-1 text-sm text-ink-soft">{recipe.description}</p>
                  {recipe.trendSource && (
                    <p className="mt-1 text-xs font-bold text-accent">
                      Quelle: {recipe.trendSource}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs font-medium text-ink-soft">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {recipe.prepTimeMin} Min.
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {recipe.servings}{" "}
                    {recipe.servings === 1 ? "Portion" : "Portionen"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Flame className="h-3.5 w-3.5" /> {approxKcal(recipe.kcal)}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <MacroChip label="Protein" value={recipe.proteinG} color="var(--color-protein)" />
                  <MacroChip label="Carbs" value={recipe.carbsG} color="var(--color-carbs)" />
                  <MacroChip label="Fett" value={recipe.fatG} color="var(--color-fat)" />
                </div>

                {recipe.portionMultiplier && Math.abs(recipe.portionMultiplier - 1) > 0.05 && (
                  <p className="rounded-md border border-primary/25 bg-primary-soft px-3 py-2 text-xs font-medium text-primary-dark">
                    Portion × {recipe.portionMultiplier.toFixed(1).replace(".", ",")} an dein
                    Tagesziel angepasst. Mengen unten sind bereits umgerechnet.
                  </p>
                )}

                {recipe.personalization && (
                  <p className="rounded-md border border-primary/25 bg-primary-soft px-3 py-2 text-xs font-medium text-primary-dark">
                    Für dich angepasst:{" "}
                    {recipe.personalization.swaps.map((s) => `${s.to} statt ${s.from}`).join(", ")}. Nährwerte
                    sind mit den neuen Zutaten berechnet.
                  </p>
                )}

                <div>
                  <h3 className="font-display mb-2 text-base font-bold text-ink">Zutaten</h3>
                  <ul className="flex flex-col gap-1.5">
                    {recipe.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
                        {ing}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-display mb-2 text-base font-bold text-ink">Zubereitung</h3>
                  <ol className="flex flex-col gap-3">
                    {recipe.instructions.map((step, i) => (
                      <li key={i} className="flex gap-3 text-sm text-ink-soft">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-dark">
                          {i + 1}
                        </span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
  );

  return mounted ? createPortal(modal, document.body) : null;
}

/** Ein Rezept mit eigenem Trigger-Button und eigenem Dialog, für Stellen mit genau einem Rezept. */
export function RecipeDetailModal({
  recipe,
  trigger,
}: {
  recipe: RecipeDetail;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition-colors duration-[var(--duration-fast)] hover:border-primary hover:text-primary-dark"
      >
        {trigger ?? (
          <>
            <ChefHat className="h-3.5 w-3.5" /> Rezept ansehen
          </>
        )}
      </button>
      <RecipeDetailDialog recipe={open ? recipe : null} onClose={close} returnFocusRef={triggerRef} />
    </>
  );
}
