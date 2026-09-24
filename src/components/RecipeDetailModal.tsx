"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChefHat, Clock, Flame, TrendingUp, Users, X } from "lucide-react";
import { approxGrams, approxKcal } from "@/lib/format";
import { useDialogBehavior } from "@/components/ui/useDialogBehavior";
import { RECIPE_TYPE_TONES, RecipeTypeIcon } from "@/components/RecipeTypeIcon";
import type { PersonalizedVariant } from "@/lib/recipes/personalization";
import type { RecipeTypeKey } from "@/lib/recipes/recipeType";
import { availableVariant, detailView, nutritionSummary, replacementRows, variantTeaser } from "@/lib/recipes/variantView";

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
  /** Anzeigenamen der Rezept-Tags; nur vom Rezeptkatalog gesetzt, an anderen Stellen bleibt der Dialog wie bisher. */
  tagLabels?: string[];
  /** Rezepttyp (Icon + Einordnung); nur vom Rezeptkatalog gesetzt. Ohne ihn zeigt der Dialog wie bisher den Anfangsbuchstaben. */
  category?: { key: RecipeTypeKey; label: string };
  /** Optionale "Für dich angepasst"-Variante (Rezeptkatalog); das Original bleibt unverändert, der Nutzer entscheidet ausdrücklich. */
  variant?: PersonalizedVariant;
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

/** Der ruhige Auswahlbereich: erst ein Angebot, nach der ausdrücklichen Entscheidung die Ersetzungen. */
function VariantControl({
  recipe,
  variant,
  personalized,
  onChange,
}: {
  recipe: RecipeDetail;
  variant: PersonalizedVariant;
  personalized: boolean;
  onChange: (personalized: boolean) => void;
}) {
  if (!personalized) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-bg-dim/70 px-4 py-3">
        <p className="min-w-0 flex-1 text-[13px] text-ink-soft">{variantTeaser(variant)}</p>
        <button
          type="button"
          onClick={() => onChange(true)}
          className="shrink-0 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:bg-black"
        >
          Für dich anpassen
        </button>
      </div>
    );
  }

  return (
    <section aria-label="Für dich angepasst" className="rounded-md border border-primary/25 bg-primary-soft px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-label text-primary-dark">Für dich angepasst</h3>
        <button
          type="button"
          onClick={() => onChange(false)}
          className="text-[13px] font-semibold text-primary-dark underline underline-offset-2 hover:text-ink"
        >
          Original anzeigen
        </button>
      </div>
      <ul className="mt-3 flex flex-col gap-2.5">
        {replacementRows(variant).map((row) => (
          <li key={row.title}>
            <span className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-[13.5px] font-semibold text-ink">{row.title}</span>
              {row.quantity && <span className="num text-[12.5px] text-ink-soft">{row.quantity}</span>}
            </span>
            <span className="block text-[12px] text-ink-soft">{row.reason}</span>
          </li>
        ))}
      </ul>
      <p className="num mt-3 border-t border-primary/15 pt-3 text-[13px] font-semibold text-primary-dark">{nutritionSummary(variant)}</p>
      <p className="num text-[12px] text-ink-soft">Original: {nutritionSummary(recipe)}</p>
      {variant.stillBlockedByAllergy && (
        <p className="mt-2 text-[12px] font-medium text-danger">Auch diese Variante enthält noch Allergene aus deinem Profil.</p>
      )}
    </section>
  );
}

/**
 * Inhalt des Rezept-Dialogs unterhalb des Kopfes. Rein darstellend: `personalized` und
 * `onPersonalizedChange` kommen vom Dialog, der die Wahl des Nutzers hält (nur im Speicher,
 * nichts wird gespeichert). Ohne `recipe.variant` erscheint keinerlei Auswahl.
 */
export function RecipeDetailContent({
  recipe,
  titleId,
  personalized,
  onPersonalizedChange,
}: {
  recipe: RecipeDetail;
  titleId: string;
  personalized: boolean;
  onPersonalizedChange: (personalized: boolean) => void;
}) {
  const variant = availableVariant(recipe);
  const view = detailView(recipe, personalized);

  return (
    <div className="flex flex-col gap-5 p-6">
      <div>
        {recipe.category && <span className="text-label text-ink-faint">{recipe.category.label}</span>}
        <h2 id={titleId} className={`font-display text-2xl font-bold text-ink ${recipe.category ? "mt-1" : ""}`}>{recipe.name}</h2>
        <p className="mt-1 text-sm text-ink-soft">{recipe.description}</p>
        {recipe.trendSource && (
          <p className="mt-1 text-xs font-bold text-accent">
            Quelle: {recipe.trendSource}
          </p>
        )}
        {recipe.tagLabels && recipe.tagLabels.length > 0 && (
          <ul aria-label="Kategorien" className="mt-3 flex flex-wrap gap-1.5">
            {recipe.tagLabels.map((label) => (
              <li key={label} className="rounded-full bg-bg-dim px-2.5 py-1 text-[11.5px] font-medium text-ink-soft">
                {label}
              </li>
            ))}
          </ul>
        )}
      </div>

      {variant && <VariantControl recipe={recipe} variant={variant} personalized={personalized} onChange={onPersonalizedChange} />}

      <div className="flex items-center gap-4 text-xs font-medium text-ink-soft">
        <span className="flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {recipe.prepTimeMin} Min.
        </span>
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {recipe.servings}{" "}
          {recipe.servings === 1 ? "Portion" : "Portionen"}
        </span>
        <span className="flex items-center gap-1">
          <Flame className="h-3.5 w-3.5" /> {approxKcal(view.kcal)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <MacroChip label="Protein" value={view.proteinG} color="var(--color-protein)" />
        <MacroChip label="Carbs" value={view.carbsG} color="var(--color-carbs)" />
        <MacroChip label="Fett" value={view.fatG} color="var(--color-fat)" />
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
          {view.ingredients.map((ing, i) => (
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
  // Welches Rezept gerade in der "Für dich angepasst"-Ansicht ist (nur im Speicher, nie gespeichert).
  // Schließen setzt zurück: beim erneuten Öffnen ist wieder das Original zu sehen.
  const [personalizedFor, setPersonalizedFor] = useState<string | null>(null);
  if (recipe === null && personalizedFor !== null) setPersonalizedFor(null);
  const personalized = recipe !== null && personalizedFor === recipe.id;
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
                style={{ background: recipe.category ? RECIPE_TYPE_TONES[recipe.category.key] : toneFor(recipe.name) }}
              >
                {recipe.category ? (
                  <RecipeTypeIcon type={recipe.category.key} className="h-9 w-9 text-ink/70" strokeWidth={1.5} />
                ) : (
                  <span className="font-display text-4xl text-ink/70">{recipe.name.trim().charAt(0).toUpperCase()}</span>
                )}
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

              <RecipeDetailContent
                recipe={recipe}
                titleId={titleId}
                personalized={personalized}
                onPersonalizedChange={(on) => setPersonalizedFor(on ? recipe.id : null)}
              />
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
