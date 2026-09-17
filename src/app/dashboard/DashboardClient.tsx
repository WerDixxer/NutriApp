"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, X } from "lucide-react";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { SLOT_LABELS } from "@/lib/labels";
import { approxGrams, approxKcal } from "@/lib/format";

export interface PlanItemView {
  id: string;
  slot: string;
  time: string;
  recipe: RecipeDetail;
}

export interface LogEntryView {
  id: string;
  slot: string;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Targets {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function Stat({
  label,
  value,
  unit,
  target,
  consumed,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  target: number;
  consumed: number;
  color?: string;
}) {
  const pct = target > 0 ? Math.min((consumed / target) * 100, 100) : 0;
  return (
    <div className="flex-1 min-w-[120px]">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </div>
      <div className="num mt-1.5 text-[34px] font-extrabold leading-none tracking-tight text-ink">
        {value}
        <span className="ml-1 text-base font-semibold text-ink-soft">{unit}</span>
      </div>
      {color && (
        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-bg-dim">
          <motion.div
            className="h-full rounded-full"
            style={{ background: color }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({
  date,
  targets,
  initialPlanItems,
  initialEntries,
}: {
  date: string;
  targets: Targets;
  initialPlanItems: PlanItemView[];
  initialEntries: LogEntryView[];
}) {
  const [entries, setEntries] = useState<LogEntryView[]>(initialEntries);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const consumed = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  const entryBySlot = useMemo(() => new Map(entries.map((e) => [e.slot, e])), [entries]);

  const featured = useMemo(() => {
    if (initialPlanItems.length === 0) return null;
    const unlogged = initialPlanItems.filter((i) => !entryBySlot.has(i.slot));
    const pool = unlogged.length > 0 ? unlogged : initialPlanItems;
    const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
    return [...pool].sort(
      (a, b) => Math.abs(toMinutes(a.time) - nowMinutes) - Math.abs(toMinutes(b.time) - nowMinutes),
    )[0];
  }, [initialPlanItems, entryBySlot]);

  async function logMeal(item: PlanItemView) {
    setLoadingId(item.id);
    try {
      const res = await fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          slot: item.slot,
          recipeId: item.recipe.id,
          customName: item.recipe.name,
          kcal: item.recipe.kcal,
          proteinG: item.recipe.proteinG,
          carbsG: item.recipe.carbsG,
          fatG: item.recipe.fatG,
        }),
      });
      const data = await res.json();
      setEntries((prev) => [
        ...prev,
        {
          id: data.entry.id,
          slot: item.slot,
          name: item.recipe.name,
          kcal: item.recipe.kcal,
          proteinG: item.recipe.proteinG,
          carbsG: item.recipe.carbsG,
          fatG: item.recipe.fatG,
        },
      ]);
    } finally {
      setLoadingId(null);
    }
  }

  async function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    await fetch(`/api/log?id=${id}`, { method: "DELETE" });
  }

  async function toggleMeal(item: PlanItemView) {
    const existing = entryBySlot.get(item.slot);
    if (existing) await removeEntry(existing.id);
    else await logMeal(item);
  }

  return (
    <div>
      <div className="mt-16 flex flex-wrap gap-x-8 gap-y-7 border-t border-border pt-9">
        <Stat label="Tagesziel" value={targets.kcal} unit="kcal" target={targets.kcal} consumed={consumed.kcal} />
        <Stat
          label="Protein"
          value={targets.proteinG}
          unit="g"
          target={targets.proteinG}
          consumed={consumed.proteinG}
          color="var(--color-protein)"
        />
        <Stat
          label="Carbs"
          value={targets.carbsG}
          unit="g"
          target={targets.carbsG}
          consumed={consumed.carbsG}
          color="var(--color-carbs)"
        />
        <Stat
          label="Fett"
          value={targets.fatG}
          unit="g"
          target={targets.fatG}
          consumed={consumed.fatG}
          color="var(--color-fat)"
        />
      </div>

      {featured && (
        <div className="mt-20">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[22px] font-bold tracking-tight text-ink">
              {entryBySlot.has(featured.slot) ? "Zuletzt geloggt" : "Als Nächstes dran"}
            </h2>
            <span className="text-[13px] font-medium text-ink-soft">
              {featured.time} Uhr · {SLOT_LABELS[featured.slot] ?? featured.slot}
            </span>
          </div>
          <div className="grid grid-cols-1 items-center gap-9 md:grid-cols-[1.15fr_1fr]">
            <RecipeThumb recipe={featured.recipe} className="aspect-[5/4] rounded-[28px] text-[96px]" />
            <div>
              <h3 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink">
                {featured.recipe.name}
              </h3>
              <p className="mt-2.5 max-w-[40ch] text-[15px] leading-relaxed text-ink-soft">
                {featured.recipe.description}
              </p>
              <div className="mt-5 flex gap-6">
                <div>
                  <div className="num text-lg font-extrabold text-ink">{approxKcal(featured.recipe.kcal)}</div>
                </div>
                <div>
                  <div className="num text-lg font-extrabold text-ink">{approxGrams(featured.recipe.proteinG)}</div>
                  <div className="text-xs text-ink-soft">Protein</div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <RecipeDetailModal recipe={featured.recipe} trigger="Rezept ansehen" />
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggleMeal(featured)}
                  disabled={loadingId === featured.id}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-semibold transition disabled:opacity-50 ${
                    entryBySlot.has(featured.slot) ? "bg-bg-dim text-ink-soft" : "bg-ink text-white hover:bg-black"
                  }`}
                >
                  {entryBySlot.has(featured.slot) ? (
                    <>
                      <X className="h-3.5 w-3.5" /> Entfernen
                    </>
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" /> Als gegessen loggen
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-20">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[22px] font-bold tracking-tight text-ink">Dein Plan heute</h2>
          <span className="text-[13px] font-medium text-ink-soft">
            {initialPlanItems.length} {initialPlanItems.length === 1 ? "Mahlzeit" : "Mahlzeiten"}
          </span>
        </div>
        {initialPlanItems.length === 0 && (
          <p className="py-6 text-sm text-ink-soft">
            Kein Plan verfügbar. Eventuell passt kein Rezept zu deinen Einstellungen für einen Slot.
          </p>
        )}
        {initialPlanItems.map((item) => {
          const logged = entryBySlot.has(item.slot);
          return (
            <div key={item.id} className="flex items-center gap-4 border-b border-border py-4">
              <RecipeDetailModal
                recipe={item.recipe}
                trigger={
                  <span className="flex min-w-0 flex-1 items-center gap-4 text-left">
                    <span className="w-12 shrink-0 text-[13px] font-bold text-ink-soft">{item.time}</span>
                    <RecipeThumb recipe={item.recipe} className="h-11 w-11 shrink-0 rounded-xl text-[22px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px] font-semibold text-ink">{item.recipe.name}</span>
                      <span className="block text-xs font-medium text-ink-soft">
                        {SLOT_LABELS[item.slot] ?? item.slot}
                        {item.recipe.isTrending ? " · 🔥 Trend" : ""}
                      </span>
                    </span>
                  </span>
                }
              />
              <span className="hidden shrink-0 text-right text-xs font-medium text-ink-soft sm:block">
                {approxKcal(item.recipe.kcal)}
                <br />
                {approxGrams(item.recipe.proteinG)} Protein
              </span>
              <button
                onClick={() => toggleMeal(item)}
                disabled={loadingId === item.id}
                aria-label={logged ? "Aus Tracker entfernen" : "Als gegessen loggen"}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:opacity-50 ${
                  logged ? "bg-ink text-white" : "border border-border text-ink-soft hover:border-ink hover:text-ink"
                }`}
              >
                {logged ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-20 pb-4">
        <h2 className="mb-4 text-[22px] font-bold tracking-tight text-ink">Getrackt heute</h2>
        {entries.length === 0 && <p className="text-sm text-ink-soft">Noch nichts geloggt.</p>}
        {entries.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-4 border-b border-border py-3">
            <div className="min-w-0">
              <div className="truncate text-[14.5px] font-medium text-ink">{e.name}</div>
              <div className="text-xs text-ink-soft">
                {SLOT_LABELS[e.slot] ?? e.slot} · {approxKcal(e.kcal)}
              </div>
            </div>
            <button
              onClick={() => removeEntry(e.id)}
              className="shrink-0 text-xs font-semibold text-ink-soft hover:text-primary"
            >
              Entfernen
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
