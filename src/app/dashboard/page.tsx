import { MessageCircle, Camera } from "lucide-react";
import { prisma } from "@/lib/db";
import { calcFullTargets } from "@/lib/nutrition";
import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import DashboardClient, { type LogEntryView, type PlanItemView } from "./DashboardClient";
import { GOAL_LABELS } from "@/lib/labels";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { DecideRing } from "@/components/DecideRing";
import { requireProfile } from "@/lib/session";
import { analyzeRecipesForProfile, toPersonalizationInput } from "@/lib/recipes/recipeService";
import { getInsightsForProfile } from "@/lib/insights/insightService";
import { forSurface } from "@/lib/insights/dedupe";
import type { InsightView } from "@/components/insights/InsightsPanel";

const DASHBOARD_INSIGHT_LIMIT = 3;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default async function DashboardPage() {
  const profile = await requireProfile();

  const targets = calcFullTargets({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    goalRateKgPerWeek: profile.goalRateKgPerWeek,
    sportType: profile.sportType,
  });

  const today = startOfDay(new Date());
  const plan = await getOrGenerateDayPlan(profile.id, today);
  const entries = await prisma.logEntry.findMany({
    where: { profileId: profile.id, date: today },
    orderBy: { createdAt: "asc" },
  });

  // Lieblingslebensmittel -> personalisierte Rezeptvariante ("Magerquark statt Skyr").
  // Nur Rezepte mit strukturierten Zutaten werden angepasst, alle anderen bleiben Original.
  const analyses = await analyzeRecipesForProfile(
    profile.id,
    plan.items.map((item) => ({ id: item.recipe.id, servings: item.recipe.servings, ingredients: item.recipe.ingredients })),
  );

  const planItems: PlanItemView[] = plan.items.map((item) => ({
    id: item.id,
    slot: item.slot,
    time: item.time,
    recipe: dbRecipeToDetail(
      item.recipe,
      item.portionMultiplier,
      toPersonalizationInput(analyses.get(item.recipe.id)?.personalized),
    ),
  }));

  const entryViews: LogEntryView[] = entries.map((e) => ({
    id: e.id,
    slot: e.slot,
    name: e.customName ?? "Eintrag",
    kcal: e.kcal,
    proteinG: e.proteinG,
    carbsG: e.carbsG,
    fatG: e.fatG,
  }));

  const todayLabel = today.toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "long" });
  const trainingToday = profile.sportType !== "NONE";

  const allInsights = await getInsightsForProfile(profile.id, today);
  const insights: InsightView[] = forSurface(allInsights, "DASHBOARD")
    .slice(0, DASHBOARD_INSIGHT_LIMIT)
    .map((i) => ({ id: i.id, message: i.message, priority: i.priority, action: i.action }));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-label text-ink-faint">{todayLabel}</span>
        <span className="flex items-center gap-2.5 text-label text-ink-faint">
          <span>{GOAL_LABELS[profile.goal]}</span>
          {trainingToday && (
            <>
              <span className="h-3 w-px bg-border" aria-hidden="true" />
              <span>Training heute</span>
            </>
          )}
        </span>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <DecideRing />
        <a
          href="/assistant"
          className="glass inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium text-ink transition-colors duration-[var(--duration-fast)] hover:bg-white"
        >
          <MessageCircle className="h-4 w-4" /> Coach fragen
        </a>
        <span className="inline-flex h-11 items-center gap-2 px-2 text-[13px] font-medium text-ink-faint">
          <Camera className="h-4 w-4" />
          Scannen
          <span className="rounded-full bg-bg-dim px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Bald verfügbar
          </span>
        </span>
      </div>

      <DashboardClient
        date={today.toISOString()}
        targets={targets}
        initialPlanItems={planItems}
        initialEntries={entryViews}
        insights={insights}
      />
    </div>
  );
}
