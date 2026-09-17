"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChefHat, Clock, Flame, Users, X } from "lucide-react";
import { approxGrams, approxKcal } from "@/lib/format";

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
}

const EMOJI_RULES: [RegExp, string][] = [
  [/gurke/i, "🥒"],
  [/udon|nudel|pasta|pad.?thai/i, "🍜"],
  [/hüttenkäse|cottage/i, "🧀"],
  [/feta/i, "🫓"],
  [/chia|pudding/i, "🍮"],
  [/dumpling|reispapier/i, "🥟"],
  [/porridge|hafer/i, "🥣"],
  [/rührei|ei|omelett/i, "🍳"],
  [/tofu/i, "🌱"],
  [/skyr|joghurt/i, "🍨"],
  [/hähnchen|chicken|pute/i, "🍗"],
  [/lachs|fisch|salmon|garnelen/i, "🐟"],
  [/linsen|curry/i, "🍛"],
  [/steak|rind/i, "🥩"],
  [/falafel|hummus/i, "🧆"],
  [/chili|bohnen/i, "🌶️"],
  [/shake|protein/i, "🥤"],
  [/ananas/i, "🍍"],
  [/studentenfutter|nüsse|trail/i, "🥜"],
  [/reiswaffel/i, "🍘"],
  [/banane/i, "🍌"],
  [/toast|brot/i, "🍞"],
  [/zucchini|pesto/i, "🍝"],
  [/honig/i, "🍯"],
];

function emojiFor(name: string, imageQuery: string): string {
  const haystack = `${name} ${imageQuery}`;
  for (const [pattern, emoji] of EMOJI_RULES) {
    if (pattern.test(haystack)) return emoji;
  }
  return "🍽️";
}

const GRADIENTS = [
  "from-emerald-100 to-lime-50",
  "from-orange-100 to-rose-50",
  "from-sky-100 to-emerald-50",
  "from-violet-100 to-indigo-50",
  "from-amber-100 to-orange-50",
];

function gradientFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
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
  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-gradient-to-br text-3xl ${gradientFor(
        recipe.name,
      )} ${className}`}
    >
      {emojiFor(recipe.name, recipe.imageQuery)}
    </div>
  );
}

export function RecipeDetailModal({
  recipe,
  trigger,
}: {
  recipe: RecipeDetail;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Portal braucht `document.body`, das während SSR nicht existiert. Flag wird
  // erst nach dem Hydration-Mount gesetzt, um einen Markup-Mismatch zu vermeiden.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const modal = (
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl border border-border bg-white sm:rounded-xl sm:shadow-hard"
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 20, opacity: 0, scale: 0.98 }}
              transition={{ type: "spring", damping: 26, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className={`relative flex h-32 items-center justify-center border-b border-border bg-gradient-to-br text-5xl ${gradientFor(
                  recipe.name,
                )}`}
              >
                {emojiFor(recipe.name, recipe.imageQuery)}
                <button
                  onClick={() => setOpen(false)}
                  className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-white text-ink-soft hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
                {recipe.isTrending && (
                  <span className="absolute left-4 top-4 flex items-center gap-1 rounded-full border border-accent/30 bg-white px-2.5 py-1 text-xs font-semibold text-accent">
                    <span className="animate-flame">🔥</span> Trend
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-5 p-6">
                <div>
                  <h2 className="font-display text-2xl font-bold text-ink">{recipe.name}</h2>
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

                <div>
                  <h3 className="font-display mb-2 text-base font-bold text-ink">Zutaten</h3>
                  <ul className="flex flex-col gap-1.5">
                    {recipe.ingredients.map((ing, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
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

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3.5 py-1.5 text-xs font-semibold text-ink transition hover:border-primary hover:text-primary-dark"
      >
        {trigger ?? (
          <>
            <ChefHat className="h-3.5 w-3.5" /> Rezept ansehen
          </>
        )}
      </button>
      {mounted && createPortal(modal, document.body)}
    </>
  );
}
