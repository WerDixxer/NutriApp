"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
import { RecipeDetailDialog } from "@/components/RecipeDetailModal";
import { approxKcal } from "@/lib/format";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { formatPortionLabel, toggleOpenDay, type LedgerDay, type LedgerMeal, type PlanRecipe } from "@/lib/weekLedger";

function insightCountLabel(count: number): string {
  return count === 1 ? "1 Hinweis" : `${count} Hinweise`;
}

/** Weekday/date column: identical for open, closed and empty rows so the ledger stays aligned. */
function DayMark({ day }: { day: LedgerDay }) {
  return (
    <span className="flex flex-col leading-none">
      <span aria-hidden="true" className={`text-label ${day.isToday ? "text-primary" : "text-ink-faint"}`}>
        {day.weekdayShort}
      </span>
      <span aria-hidden="true" className={`num mt-1.5 text-[22px] font-bold ${day.isToday ? "text-primary" : "text-ink"}`}>
        {day.dayOfMonth}
      </span>
      <span className="sr-only">
        {day.weekdayLabel}, {day.dateLabel}
      </span>
    </span>
  );
}

function MealRow({ meal, onOpen }: { meal: LedgerMeal; onOpen: (meal: LedgerMeal, trigger: HTMLElement) => void }) {
  const portion = formatPortionLabel(meal.portionMultiplier);
  return (
    <li>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={(e) => onOpen(meal, e.currentTarget)}
        className="grid w-full grid-cols-[2.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-[var(--radius-sm)] px-1 py-2.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim sm:grid-cols-[3rem_8.5rem_minmax(0,1fr)_auto]"
      >
        <span className="num col-start-1 row-start-1 text-[12.5px] text-ink-soft">{meal.time}</span>
        <span className="text-label col-start-2 row-start-2 text-ink-faint sm:row-start-1">{meal.slotLabel}</span>
        <span className="col-start-2 row-start-1 line-clamp-2 text-[14.5px] font-medium leading-snug text-ink sm:col-start-3">
          {meal.name}
        </span>
        <span className="num col-start-3 row-start-1 text-right text-[13px] text-ink sm:col-start-4">{approxKcal(meal.kcal)}</span>
        {portion && (
          <span className="col-start-3 row-start-2 text-right text-[11.5px] text-ink-faint sm:col-start-4">{portion}</span>
        )}
        <span className="sr-only">, Rezept ansehen</span>
      </button>
    </li>
  );
}

function DayRow({
  day,
  open,
  insights,
  onToggle,
  onOpenMeal,
}: {
  day: LedgerDay;
  open: boolean;
  insights: InsightView[];
  onToggle: () => void;
  onOpenMeal: (meal: LedgerMeal, trigger: HTMLElement) => void;
}) {
  const uid = useId();
  const buttonId = `${uid}-day`;
  const panelId = `${uid}-panel`;

  if (day.meals.length === 0) {
    return (
      <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 py-4 sm:grid-cols-[3.5rem_minmax(0,1fr)] sm:gap-x-4">
        <h2>
          <DayMark day={day} />
        </h2>
        <p className="pt-1 text-[13.5px] leading-snug text-ink-soft">Für diesen Tag ist noch kein Plan vorhanden.</p>
      </li>
    );
  }

  return (
    <li>
      <h2>
        <button
          id={buttonId}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-current={day.isToday ? "date" : undefined}
          onClick={onToggle}
          className="grid w-full grid-cols-[3rem_minmax(0,1fr)_1.25rem] items-start gap-x-3 py-3.5 text-left transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim/50 sm:grid-cols-[3.5rem_minmax(0,1fr)_1.25rem] sm:gap-x-4"
        >
          <DayMark day={day} />
          <span className="min-w-0">
            <span className="line-clamp-2 block text-[13.5px] font-semibold leading-snug text-ink">{day.headline}</span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-ink-soft">
              {day.isToday && <span className="font-semibold text-primary">Heute</span>}
              <span className="num">{approxKcal(day.kcalTotal)}</span>
              {day.extraCount > 0 && <span>+{day.extraCount} weitere</span>}
              {day.hasTraining && <span>Training</span>}
              {!open && insights.length > 0 && <span>{insightCountLabel(insights.length)}</span>}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`mt-0.5 h-4 w-4 text-ink-faint transition-transform duration-[var(--duration-base)] ${open ? "rotate-180" : ""}`}
          />
        </button>
      </h2>

      {/* Alle Tage bleiben im DOM (so behalten die Hinweise ihren Zustand), zugeklappt per grid-rows und `inert`. */}
      <div
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-[var(--duration-base)] ease-[var(--ease-out)] ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div id={panelId} className="px-1 pb-5 sm:pl-[4.5rem]">
            <ul className="flex flex-col">
              {day.meals.map((meal) => (
                <MealRow key={meal.id} meal={meal} onOpen={onOpenMeal} />
              ))}
            </ul>
            <div className="mt-2 flex items-baseline justify-between border-t border-border px-1 pt-3 text-[13px]">
              <span className="text-ink-soft">Tag gesamt</span>
              <span className="num font-semibold text-ink">{approxKcal(day.kcalTotal)}</span>
            </div>
            {insights.length > 0 && (
              <div className="mt-4">
                <InsightsPanel initialInsights={insights} />
              </div>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default function WeeklyPlanLedger({
  days,
  recipes,
  initialOpenKey,
  insightsByDay,
}: {
  days: LedgerDay[];
  recipes: Record<string, PlanRecipe>;
  initialOpenKey: string | null;
  insightsByDay: Record<string, InsightView[]>;
}) {
  const [openKey, setOpenKey] = useState<string | null>(initialOpenKey);
  const [selected, setSelected] = useState<{ recipeId: string; portionMultiplier: number } | null>(null);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const openMeal = useCallback((meal: LedgerMeal, trigger: HTMLElement) => {
    lastTriggerRef.current = trigger;
    setSelected({ recipeId: meal.recipeId, portionMultiplier: meal.portionMultiplier });
  }, []);
  const closeMeal = useCallback(() => setSelected(null), []);

  // Das Rezept wird erst beim Öffnen auf die geplante Portion umgerechnet.
  const detail = useMemo(() => {
    const recipe = selected ? recipes[selected.recipeId] : undefined;
    return recipe && selected ? dbRecipeToDetail({ ...recipe, imageQuery: null }, selected.portionMultiplier) : null;
  }, [recipes, selected]);

  return (
    <>
      <ol className="mt-8 divide-y divide-border border-y border-border" aria-label="Wochenplan">
        {days.map((day) => (
          <DayRow
            key={day.key}
            day={day}
            open={openKey === day.key}
            insights={insightsByDay[day.key] ?? []}
            onToggle={() => setOpenKey((current) => toggleOpenDay(current, day.key))}
            onOpenMeal={openMeal}
          />
        ))}
      </ol>
      <RecipeDetailDialog recipe={detail} onClose={closeMeal} returnFocusRef={lastTriggerRef} />
    </>
  );
}
