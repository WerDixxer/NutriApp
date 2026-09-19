"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus, X } from "lucide-react";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { CalorieRing } from "@/components/CalorieRing";
import { EmptyState } from "@/components/ui/EmptyState";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
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

/**
 * Feste Spaltenbreiten für Label und Wert: der Balken darf sich ändern,
 * Label und Zahl bleiben an derselben Stelle stehen - egal ob der Wert
 * "8 g" oder "180 g" lautet (siehe Kapitel-Vorgabe "Stable structure,
 * dynamic content"). Werte bewusst groß (19px/bold) - Makros sind primäre
 * Information, direkt nach der kcal-Restmenge die zweitwichtigste Zahl
 * auf der Seite.
 */
function MacroRow({
  label,
  value,
  target,
  color,
  inverse = false,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  inverse?: boolean;
}) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-4">
      <span className={`w-16 shrink-0 text-[13px] font-semibold ${inverse ? "text-on-inverse-soft" : "text-ink-soft"}`}>
        {label}
      </span>
      <div
        className="h-[7px] min-w-0 flex-1 overflow-hidden rounded-full"
        style={{ background: inverse ? "rgba(255,255,255,0.12)" : "var(--color-bg-dim)" }}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <span className={`num w-[112px] shrink-0 text-right text-[19px] font-bold leading-none ${inverse ? "text-on-inverse" : "text-ink"}`}>
        {Math.round(value)}
        <span className={`text-[13px] font-medium ${inverse ? "text-on-inverse-soft" : "text-ink-faint"}`}> / {Math.round(target)} g</span>
      </span>
    </div>
  );
}

/**
 * Fixe Höhe unabhängig vom Status (offen/erledigt) - nur der Check/Plus-
 * Kreis wechselt, die Zeile selbst springt nie. `min-w-0` + `truncate` auf
 * dem Label verhindert, dass ein langes Label (z.B. "Nach dem Training")
 * den Aktions-Kreis aus der Zeile drückt.
 *
 * Zwei Varianten statt einer Karte mit Media-Query-Override: `rail` (mobil,
 * horizontales Scrollen, per Trennlinie links statt Kartenrahmen getrennt)
 * und `grid` (Desktop, volle Breite, per Trennlinie oben getrennt) - siehe
 * Kapitel-Vorgabe "weniger Karten-Gefühl, editorial statt Kachelraster".
 * Kein eigener Kartenrahmen/-hintergrund mehr, nur eine dezente Trennlinie.
 */
function MealChip({
  item,
  logged,
  loading,
  onToggle,
  variant = "grid",
}: {
  item: PlanItemView;
  logged: boolean;
  loading: boolean;
  onToggle: () => void;
  variant?: "rail" | "grid";
}) {
  return (
    <div
      className={`flex flex-col gap-3 pt-4 ${
        variant === "rail"
          ? "w-[156px] shrink-0 border-l border-border pl-4 first:border-l-0 first:pl-0"
          : "border-t border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-label text-ink-faint">{SLOT_LABELS[item.slot] ?? item.slot}</span>
        <button
          onClick={onToggle}
          disabled={loading}
          aria-label={logged ? "Aus Tracker entfernen" : "Als gegessen markieren"}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-[var(--duration-fast)] disabled:opacity-50 ${
            logged ? "animate-check-pop bg-ink text-white" : "border border-border text-ink-soft hover:border-ink hover:text-ink"
          }`}
        >
          {logged ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>
      <RecipeDetailModal
        recipe={item.recipe}
        trigger={
          <span className="flex flex-col items-start gap-2 text-left">
            <RecipeThumb recipe={item.recipe} className="h-9 w-9 rounded-[var(--radius-sm)] text-base" />
            <span className="line-clamp-2 min-h-[2.6em] text-[13px] font-semibold leading-snug text-ink">
              {item.recipe.name}
            </span>
          </span>
        }
      />
      <span className="num text-[11px] font-medium text-ink-faint">{item.time} {approxKcal(item.recipe.kcal)}</span>
    </div>
  );
}

export default function DashboardClient({
  date,
  targets,
  initialPlanItems,
  initialEntries,
  insights,
}: {
  date: string;
  targets: Targets;
  initialPlanItems: PlanItemView[];
  initialEntries: LogEntryView[];
  insights: InsightView[];
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
  const remaining = Math.max(targets.kcal - consumed.kcal, 0);

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
      {/* Kalorien + Makros: der Ring bleibt die Hauptmetrik. Eigenes dunkles
          Panel (die einzige weitere .glass-dark-verwandte Fläche neben der
          Nav) gibt dem wichtigsten Modul der Seite spürbaren Kontrast statt
          "hellgrau auf hellgrau". */}
      <div className="mt-8 rounded-[var(--radius-lg)] bg-surface-inverse px-6 py-7 sm:px-8 sm:py-8">
        <div className="text-label flex items-center justify-between text-on-inverse-soft">
          <span>Tagesziel</span>
          <span className="num text-tech text-[17px] font-semibold text-on-inverse">
            {Math.round((consumed.kcal / Math.max(targets.kcal, 1)) * 100)}%
          </span>
        </div>
        <div className="mt-6 grid grid-cols-1 items-center gap-x-12 gap-y-8 sm:grid-cols-[auto_1fr]">
          <div className="flex justify-center sm:justify-start">
            <CalorieRing value={consumed.kcal} target={targets.kcal} size={188} strokeWidth={14} inverse />
          </div>
          <div className="flex flex-col gap-5">
            <div>
              <div className="num font-display text-[52px] font-bold leading-[0.95] text-on-inverse sm:text-[60px]">
                {remaining}
              </div>
              <div className="mt-2 text-[13.5px] font-medium text-on-inverse-soft">kcal übrig heute</div>
            </div>
            <div className="flex flex-col gap-3">
              <MacroRow label="Protein" value={consumed.proteinG} target={targets.proteinG} color="var(--color-protein)" inverse />
              <MacroRow label="Carbs" value={consumed.carbsG} target={targets.carbsG} color="var(--color-carbs)" inverse />
              <MacroRow label="Fett" value={consumed.fatG} target={targets.fatG} color="var(--color-fat)" inverse />
            </div>
          </div>
        </div>
      </div>

      {insights.length > 0 && (
        <div className="mt-6">
          <InsightsPanel initialInsights={insights} />
        </div>
      )}

      {featured && (
        <div className="mt-14">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-h2 text-ink">
              {entryBySlot.has(featured.slot) ? "Zuletzt geloggt" : "Als Nächstes dran"}
            </h2>
            <span className="text-label text-ink-faint">
              {featured.time} Uhr {SLOT_LABELS[featured.slot] ?? featured.slot}
            </span>
          </div>
          <div className="grid grid-cols-1 items-center gap-8 md:grid-cols-[240px_1fr]">
            <RecipeThumb recipe={featured.recipe} className="aspect-[5/4] rounded-[var(--radius-lg)] text-[64px] md:aspect-square" />
            <div className="min-h-[132px]">
              <h3 className="text-h2 text-ink">{featured.recipe.name}</h3>
              <p className="text-body mt-2 line-clamp-2 max-w-[46ch] text-ink-soft">{featured.recipe.description}</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <RecipeDetailModal recipe={featured.recipe} trigger="Rezept ansehen" />
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => toggleMeal(featured)}
                  disabled={loadingId === featured.id}
                  className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition-colors duration-[var(--duration-fast)] disabled:opacity-50 ${
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
                <span className="num text-[13px] font-medium text-ink-soft">
                  {approxKcal(featured.recipe.kcal)} {approxGrams(featured.recipe.proteinG)} Protein
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-14">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-h2 text-ink">Heute</h2>
          <span className="text-label text-ink-faint">
            {initialPlanItems.length} {initialPlanItems.length === 1 ? "Mahlzeit" : "Mahlzeiten"}
          </span>
        </div>
        {initialPlanItems.length === 0 ? (
          <EmptyState
            title="Noch kein Plan für heute"
            description="Passt kein Rezept zu deinen Einstellungen für einen Slot. Schau in deinen Profileinstellungen vorbei."
          />
        ) : (
          <>
            {/* Mobil: horizontales Scrollen, jeder Slot behält seine eigene
                Breite. Ab sm: eigene Zeile (siehe unten), die die volle
                Breite ausnutzt - zwei getrennte Bäume statt einer Klasse,
                die per Breakpoint umdefiniert wird (siehe Kapitel-Vorgabe zu
                Cascade Layers in globals.css: `.rail` selbst per Utility zu
                überschreiben ist riskant, zwei Varianten sind es nicht). */}
            <div className="rail -mx-1 flex gap-0 px-1 pb-2 sm:hidden">
              {initialPlanItems.map((item) => (
                <MealChip
                  key={item.id}
                  item={item}
                  variant="rail"
                  logged={entryBySlot.has(item.slot)}
                  loading={loadingId === item.id}
                  onToggle={() => toggleMeal(item)}
                />
              ))}
            </div>
            <div className="hidden sm:flex sm:gap-6">
              {initialPlanItems.map((item) => (
                <div key={item.id} className="min-w-0 flex-1">
                  <MealChip
                    item={item}
                    variant="grid"
                    logged={entryBySlot.has(item.slot)}
                    loading={loadingId === item.id}
                    onToggle={() => toggleMeal(item)}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-14 pb-4">
        <h2 className="text-h2 mb-4 text-ink">Getrackt heute</h2>
        {entries.length === 0 ? (
          <p className="text-body text-ink-faint">Noch nichts geloggt. Sobald du eine Mahlzeit abhakst, taucht sie hier auf.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex min-h-[52px] items-center justify-between gap-4 border-b border-border py-3">
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium text-ink">{e.name}</div>
                <div className="text-[12px] text-ink-soft">
                  {SLOT_LABELS[e.slot] ?? e.slot} {approxKcal(e.kcal)}
                </div>
              </div>
              <button
                onClick={() => removeEntry(e.id)}
                className="shrink-0 text-xs font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary"
              >
                Entfernen
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
