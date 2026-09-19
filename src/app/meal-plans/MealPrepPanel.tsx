"use client";

import { useState } from "react";
import { SLOT_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

type Strategy = "MIN_COOKING" | "BALANCED" | "FRESHNESS";

const STRATEGY_LABELS: Record<Strategy, string> = {
  MIN_COOKING: "Wenig Kochen",
  BALANCED: "Ausgewogen",
  FRESHNESS: "Frische",
};

const UNIT_LABELS: Record<string, string> = {
  G: "g",
  KG: "kg",
  ML: "ml",
  L: "l",
  PIECE: "Stück",
  PACK: "Packung",
  PORTION: "Portion",
};

interface PrepTaskView {
  displayName: string;
  totalQuantity: number;
  unit: string;
  usedForMeals: { recipeName: string; slot: string; date: string }[];
  pantry: { availableQuantity: number; urgency: string | null } | null;
}

interface PrepGroupView {
  id: string;
  name: string;
  tasks: PrepTaskView[];
  earliestNeededDate: string;
  combinedPrepTimeMin: number;
}

interface SoloRecipeView {
  recipeId: string;
  recipeName: string;
  meals: { slot: string; date: string }[];
}

interface MealPrepView {
  strategy: Strategy;
  baselineCookingSessions: number;
  totalCookingSessions: number;
  prepGroups: PrepGroupView[];
  soloRecipes: SoloRecipeView[];
  unparsedIngredients: { raw: string; recipeName: string }[];
  warnings: { code: string; message: string }[];
  summary: string[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function formatQuantity(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function PrepGroupCard({ group }: { group: PrepGroupView }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-h3 text-ink">{group.name}</h3>
        <span className="text-[12px] font-medium text-ink-faint">ab {formatDate(group.earliestNeededDate)}</span>
      </div>
      <div className="mt-4 flex flex-col gap-3">
        {group.tasks.map((task) => (
          <div key={task.displayName} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink">{task.displayName}</span>
              <span className="num text-sm text-ink-soft">
                {formatQuantity(task.totalQuantity)} {UNIT_LABELS[task.unit] ?? task.unit.toLowerCase()}
              </span>
            </div>
            {task.pantry && task.pantry.availableQuantity > 0 && (
              <p className="mt-0.5 text-xs text-ink-soft">
                Davon {formatQuantity(task.pantry.availableQuantity)} {UNIT_LABELS[task.unit] ?? ""} aus deinem Vorrat.
              </p>
            )}
            <p className="mt-1 text-xs text-ink-soft">
              Verwendet für{" "}
              {task.usedForMeals.map((m, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  {SLOT_LABELS[m.slot] ?? m.slot} ({formatDate(m.date)})
                </span>
              ))}
            </p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function MealPrepPanel({ mealPlanId }: { mealPlanId: string }) {
  const [open, setOpen] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("BALANCED");
  const [data, setData] = useState<MealPrepView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(nextStrategy: Strategy) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/meal-plans/${mealPlanId}/meal-prep?strategy=${nextStrategy}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Meal Prep konnte nicht berechnet werden.");
      setData(body.mealPrep);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-10 border-t border-border pt-8">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            load(strategy);
          }}
        >
          Meal Prep optimieren
        </Button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up mt-10 border-t border-border pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-h3 text-ink">Dein Meal Prep</h2>
        <div className="flex gap-2">
          {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
            <Pill
              key={s}
              active={strategy === s}
              onClick={() => {
                setStrategy(s);
                load(s);
              }}
            >
              {STRATEGY_LABELS[s]}
            </Pill>
          ))}
        </div>
      </div>

      {loading && (
        <div className="mt-6 flex flex-col gap-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
      )}
      {error && <p className="mt-6 text-[14px] font-semibold text-danger">{error}</p>}

      {!loading && data && (
        <div className="mt-6">
          <div className="flex items-baseline gap-3">
            <span className="num font-display text-[32px] text-ink">{data.totalCookingSessions}</span>
            <span className="text-body text-ink-soft">
              Kochvorgänge{data.totalCookingSessions < data.baselineCookingSessions ? ` statt ${data.baselineCookingSessions}` : ""}
            </span>
          </div>

          {data.summary.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1">
              {data.summary.slice(1).map((line, i) => (
                <li key={i} className="text-[14px] text-ink-soft">
                  {line}
                </li>
              ))}
            </ul>
          )}

          {data.prepGroups.length > 0 && (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {data.prepGroups.map((group) => (
                <PrepGroupCard key={group.id} group={group} />
              ))}
            </div>
          )}

          {data.soloRecipes.length > 0 && (
            <div className="mt-6">
              <h3 className="text-label mb-2 text-ink-faint">Eigenständige Rezepte</h3>
              {data.soloRecipes.map((recipe) => (
                <div key={recipe.recipeId} className="flex min-h-[44px] items-center justify-between border-b border-border py-2.5 text-[14px]">
                  <span className="text-ink">{recipe.recipeName}</span>
                  <span className="text-[12px] text-ink-soft">
                    {recipe.meals.map((m, i) => (
                      <span key={i}>
                        {i > 0 && ", "}
                        {SLOT_LABELS[m.slot] ?? m.slot} ({formatDate(m.date)})
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {data.warnings.length > 0 && (
            <Card className="mt-6 p-4">
              {data.warnings.map((w) => (
                <p key={w.code} className="text-[12px] text-ink-soft">
                  {w.message}
                </p>
              ))}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
