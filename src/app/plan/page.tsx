import { getOrGenerateWeekPlan } from "@/lib/generateMealPlan";
import { requireProfileId } from "@/lib/session";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getInsightsForProfile } from "@/lib/insights/insightService";
import { forSurface } from "@/lib/insights/dedupe";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
import { assignInsightsToDays, buildWeekLedger, collectPlanRecipes } from "@/lib/weekLedger";
import WeeklyPlanLedger from "./WeeklyPlanLedger";
import WeeklyShoppingSheet from "./WeeklyShoppingSheet";
import { startOfWeek, todayForUser } from "@/lib/calendarDate";

export default async function WeekPlanPage() {
  const profileId = await requireProfileId();

  const now = new Date();
  const today = todayForUser(now);
  const monday = startOfWeek(today);

  // Nacheinander statt parallel: jeder Tag berücksichtigt die Rezepte der Tage davor.
  const plans = await getOrGenerateWeekPlan(profileId, monday);
  const ledger = buildWeekLedger({ weekStart: monday, plans, today });
  const recipes = collectPlanRecipes(plans);

  // Jedes Insight erscheint im Tag seiner Mahlzeit statt als Block über der ganzen Woche.
  const allInsights = await getInsightsForProfile(profileId, now);
  const { byDay, unassigned } = assignInsightsToDays(ledger.days, forSurface(allInsights, "PLAN"));
  // Kein Link "Wochenplan ansehen" hier - wir sind bereits auf /plan.
  const toView = (i: (typeof unassigned)[number]): InsightView => ({
    id: i.id,
    message: i.message,
    priority: i.priority,
    action: i.action?.href === "/plan" ? undefined : i.action,
  });
  const insightsByDay = Object.fromEntries(Object.entries(byDay).map(([key, list]) => [key, list.map(toView)]));
  const unassignedViews = unassigned.map(toView);

  return (
    <div>
      <SectionHeader
        eyebrow="Diese Woche"
        title="Dein Wochenplan"
        intro={ledger.rangeLabel}
        action={<WeeklyShoppingSheet weekStart={ledger.days[0].key} rangeLabel={ledger.rangeLabel} />}
      />

      {unassignedViews.length > 0 && (
        <div className="mt-8">
          <InsightsPanel initialInsights={unassignedViews} />
        </div>
      )}

      <WeeklyPlanLedger
        days={ledger.days}
        recipes={recipes}
        initialOpenKey={ledger.initialOpenKey}
        insightsByDay={insightsByDay}
      />
    </div>
  );
}
