"use client";

import { useMemo, useState } from "react";
import { SLOT_LABELS, WEEKDAY_LABELS } from "@/lib/labels";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import MealPrepPanel from "./MealPrepPanel";

export interface MemberOptionView {
  householdMemberId: string;
  name: string;
}

export interface MealPlanSummaryView {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  mealCount: number;
}

export interface MealPlanMealView {
  id: string;
  date: string;
  slot: "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK";
  recipeId: string;
  recipeName: string;
  imageQuery: string | null;
  kcal: number;
  proteinG: number;
  portionMultiplier: number;
  reasons: string[];
}

export interface MealPlanDetailView {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  members: { householdMemberId: string; name: string | null }[];
  meals: MealPlanMealView[];
}

const SLOT_ORDER = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"];
const STATUS_LABELS: Record<string, string> = { DRAFT: "Entwurf", ACTIVE: "Aktiv", ARCHIVED: "Archiviert" };

function dateKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

function weekdayLabel(iso: string): string {
  const jsDay = new Date(iso).getDay(); // 0=So
  const mondayFirst = (jsDay + 6) % 7;
  return WEEKDAY_LABELS[mondayFirst];
}

interface RawApiPlan {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  members: { householdMemberId: string; householdMember: { user: { name: string | null } } }[];
  meals: {
    id: string;
    date: string;
    slot: string;
    recipeId: string;
    recipe: { name: string; imageQuery: string | null; kcal: number; proteinG: number };
    portionMultiplier: number;
    reasons: string;
  }[];
}

function mapApiPlanToDetail(raw: RawApiPlan): MealPlanDetailView {
  return {
    id: raw.id,
    name: raw.name,
    startDate: raw.startDate,
    endDate: raw.endDate,
    status: raw.status,
    members: raw.members.map((m) => ({ householdMemberId: m.householdMemberId, name: m.householdMember.user.name })),
    meals: raw.meals.map((meal) => ({
      id: meal.id,
      date: meal.date,
      slot: meal.slot as MealPlanMealView["slot"],
      recipeId: meal.recipeId,
      recipeName: meal.recipe.name,
      imageQuery: meal.recipe.imageQuery,
      kcal: Math.round(meal.recipe.kcal * meal.portionMultiplier),
      proteinG: Math.round(meal.recipe.proteinG * meal.portionMultiplier),
      portionMultiplier: meal.portionMultiplier,
      reasons: JSON.parse(meal.reasons) as string[],
    })),
  };
}

function MealCard({ meal }: { meal: MealPlanMealView }) {
  return (
    <Card className="flex flex-col gap-1.5 border border-border p-3.5">
      <span className="text-label text-ink-faint">{SLOT_LABELS[meal.slot] ?? meal.slot}</span>
      <p className="text-[14px] font-semibold leading-snug text-ink">{meal.recipeName}</p>
      <p className="num text-[12px] text-ink-soft">
        ~{meal.kcal} kcal ~{meal.proteinG} g Protein {meal.portionMultiplier.toFixed(1)}×
      </p>
      {meal.reasons.length > 0 && (
        <ul className="mt-1 flex flex-col gap-0.5">
          {meal.reasons.slice(0, 2).map((reason, i) => (
            <li key={i} className="text-[11px] leading-snug text-ink-soft">
              {reason}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GenerateForm({
  memberOptions,
  onGenerate,
  submitting,
  onCancel,
}: {
  memberOptions: MemberOptionView[];
  onGenerate: (input: { days: number; memberIds: string[]; includeSnack: boolean }) => void;
  submitting: boolean;
  onCancel: () => void;
}) {
  const [days, setDays] = useState<7 | 1>(7);
  const [selectedIds, setSelectedIds] = useState<string[]>(memberOptions.map((m) => m.householdMemberId));
  const [includeSnack, setIncludeSnack] = useState(false);

  function toggleMember(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onGenerate({ days, memberIds: selectedIds, includeSnack });
      }}
      className="flex flex-col gap-5 rounded-[var(--radius-md)] bg-bg-dim p-5"
    >
      <div>
        <span className="text-label text-ink-faint">Zeitraum</span>
        <div className="mt-2 flex gap-2">
          <Pill type="button" active={days === 7} onClick={() => setDays(7)}>
            7 Tage
          </Pill>
          <Pill type="button" active={days === 1} onClick={() => setDays(1)}>
            1 Tag
          </Pill>
        </div>
      </div>

      {memberOptions.length > 1 && (
        <div>
          <span className="text-label text-ink-faint">Für wen?</span>
          <div className="mt-2 flex flex-wrap gap-2">
            {memberOptions.map((m) => (
              <label key={m.householdMemberId} className="flex items-center gap-2 rounded-full bg-bg px-3 py-1.5 text-[13px] text-ink">
                <input type="checkbox" checked={selectedIds.includes(m.householdMemberId)} onChange={() => toggleMember(m.householdMemberId)} />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <label className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
        <input type="checkbox" checked={includeSnack} onChange={(e) => setIncludeSnack(e.target.checked)} />
        Snacks einplanen
      </label>

      <div className="flex items-center gap-4">
        <Button type="submit" size="sm" disabled={submitting || selectedIds.length === 0}>
          Plan erstellen
        </Button>
        <button type="button" onClick={onCancel} className="text-[13px] font-semibold text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-ink">
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function LoadingState() {
  return (
    <div className="rounded-[var(--radius-md)] bg-bg-dim p-8 text-center">
      <Skeleton className="mx-auto mb-4 h-4 w-40" />
      <p className="text-h3 text-ink">Wir bauen deinen Plan.</p>
      <p className="text-body mt-2 text-ink-soft">
        Vorräte, Ziele aller Mitglieder und verfügbare Rezepte werden gerade abgeglichen. Einen Moment.
      </p>
    </div>
  );
}

export default function MealPlansClient({
  memberOptions,
  plans,
  initialDetail,
}: {
  memberOptions: MemberOptionView[];
  plans: MealPlanSummaryView[];
  initialDetail: MealPlanDetailView | null;
}) {
  const [detail, setDetail] = useState(initialDetail);
  const [planList, setPlanList] = useState(plans);
  const [showForm, setShowForm] = useState(!initialDetail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unmetSlots, setUnmetSlots] = useState<{ date: string; slot: string; reason: string }[]>([]);

  const days = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, MealPlanMealView[]>();
    for (const meal of detail.meals) {
      const key = dateKey(meal.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(meal);
    }
    for (const meals of map.values()) meals.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [detail]);

  async function handleGenerate(input: { days: number; memberIds: string[]; includeSnack: boolean }) {
    setSubmitting(true);
    setError(null);
    setUnmetSlots([]);
    try {
      const mealTypes = ["BREAKFAST", "LUNCH", "DINNER", ...(input.includeSnack ? ["SNACK"] : [])];
      const res = await fetch("/api/meal-plans/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: new Date().toISOString().slice(0, 10),
          days: input.days,
          mealTypes,
          memberIds: input.memberIds.length < memberOptions.length ? input.memberIds : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler bei der Planerstellung.");

      if (data.status === "NO_VALID_PLAN") {
        setError(
          data.message ??
            "Für diese Kombination aus Allergien, Zielen und verfügbaren Rezepten konnte kein vollständiger Plan erstellt werden.",
        );
        setUnmetSlots(data.unmetSlots ?? []);
        return;
      }

      const mapped = mapApiPlanToDetail(data.plan);
      setDetail(mapped);
      setPlanList((prev) => [
        { id: mapped.id, name: mapped.name, startDate: mapped.startDate, endDate: mapped.endDate, status: mapped.status, mealCount: mapped.meals.length },
        ...prev,
      ]);
      setShowForm(false);
      if (data.status === "PARTIAL") {
        setUnmetSlots(data.unmetSlots ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSelectPlan(id: string) {
    const res = await fetch(`/api/meal-plans/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setDetail(mapApiPlanToDetail(data.plan));
    setError(null);
    setUnmetSlots([]);
    setShowForm(false);
  }

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-[var(--radius-md)] bg-danger-soft p-4 text-[13.5px] text-danger">
          <p className="font-semibold">{error}</p>
          {unmetSlots.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs">
              {unmetSlots.slice(0, 6).map((u, i) => (
                <li key={i}>
                  {formatDate(u.date)} {SLOT_LABELS[u.slot] ?? u.slot}: {u.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!error && unmetSlots.length > 0 && detail && (
        <div className="mb-6 rounded-[var(--radius-md)] bg-bg-dim p-4 text-[13.5px] text-ink-soft">
          Dieser Plan ist unvollständig ({unmetSlots.length} {unmetSlots.length === 1 ? "Mahlzeit" : "Mahlzeiten"}{" "}
          konnten nicht optimal geplant werden).
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          {detail && (
            <p className="text-label text-ink-faint">
              {formatDate(detail.startDate)} – {formatDate(detail.endDate)} {STATUS_LABELS[detail.status]}
            </p>
          )}
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          Meal Plan erstellen
        </Button>
      </div>

      {showForm && (
        <div className="mt-6">
          <GenerateForm memberOptions={memberOptions} onGenerate={handleGenerate} submitting={submitting} onCancel={() => setShowForm(false)} />
        </div>
      )}

      {submitting && (
        <div className="mt-6">
          <LoadingState />
        </div>
      )}

      {!submitting && detail && days.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {days.map(([key, meals]) => (
            <div key={key} className="flex min-h-[220px] flex-col gap-3 border-t-2 border-border pt-4">
              <div>
                <div className="text-h3 text-ink">{weekdayLabel(key)}</div>
                <div className="num text-[12px] text-ink-soft">{formatDate(key)}</div>
              </div>
              <div className="flex flex-col gap-2">
                {meals.map((meal) => (
                  <MealCard key={meal.id} meal={meal} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!submitting && !detail && !showForm && (
        <div className="mt-10">
          <EmptyState
            title="Noch kein Plan erstellt"
            description="Sag uns, für wie viele Tage wir planen sollen. Vorräte, Ziele und Rezepte gleichen wir automatisch ab."
            action={
              <Button size="sm" onClick={() => setShowForm(true)}>
                Meal Plan erstellen
              </Button>
            }
          />
        </div>
      )}

      {!submitting && detail && <MealPrepPanel key={detail.id} mealPlanId={detail.id} />}

      {planList.length > 1 && (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="text-h3 mb-3 text-ink">Frühere Pläne</h2>
          {planList
            .filter((p) => p.id !== detail?.id)
            .map((p) => (
              <button
                key={p.id}
                onClick={() => handleSelectPlan(p.id)}
                className="flex min-h-[52px] w-full items-center justify-between border-b border-border py-3 text-left text-[13.5px] transition-colors duration-[var(--duration-fast)] hover:text-ink"
              >
                <span className="text-ink-soft">
                  {formatDate(p.startDate)} – {formatDate(p.endDate)}, {p.mealCount} Mahlzeiten
                </span>
                <span className="text-label text-ink-faint">{STATUS_LABELS[p.status]}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
