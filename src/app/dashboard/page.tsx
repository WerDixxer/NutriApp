import { prisma } from "@/lib/db";
import { calcFullTargets } from "@/lib/nutrition";
import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import DashboardClient, { type LogEntryView, type PlanItemView } from "./DashboardClient";
import { GOAL_LABELS } from "@/lib/labels";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { DecideRing } from "@/components/DecideRing";
import { requireProfile } from "@/lib/session";

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

  const planItems: PlanItemView[] = plan.items.map((item) => ({
    id: item.id,
    slot: item.slot,
    time: item.time,
    recipe: dbRecipeToDetail(item.recipe, item.portionMultiplier),
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

  return (
    <div>
      <div className="text-sm font-semibold text-ink-soft">{todayLabel}</div>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[56px]">
        Was isst du heute,
        <br />
        {profile.user.name}?
      </h1>
      <p className="mt-4 max-w-[46ch] text-[17px] leading-relaxed text-ink-soft">
        {GOAL_LABELS[profile.goal]}
        {trainingToday ? " · Training eingeplant" : ""}. Dein Tag ist auf dein Ziel abgestimmt, du
        musst nichts nachrechnen.
      </p>

      <div className="mt-9 flex flex-wrap items-center gap-5">
        <DecideRing />
        <a
          href="/assistant"
          className="inline-flex items-center gap-2 rounded-full bg-bg-dim px-5 py-3.5 text-[15px] font-semibold text-ink transition hover:bg-[#e8e8ed]"
        >
          🎙️ Coach fragen
        </a>
        <span className="inline-flex items-center gap-2 rounded-full bg-bg-dim px-5 py-3.5 text-[15px] font-semibold text-ink-soft">
          📸 Scannen · bald
        </span>
      </div>

      <DashboardClient
        date={today.toISOString()}
        targets={targets}
        initialPlanItems={planItems}
        initialEntries={entryViews}
      />
    </div>
  );
}
