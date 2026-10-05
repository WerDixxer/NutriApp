import { getOrGenerateWeekPlan } from "@/lib/generateMealPlan";
import { requireProfileId } from "@/lib/session";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getInsightsForProfile } from "@/lib/insights/insightService";
import { forSurface } from "@/lib/insights/dedupe";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
import { assignInsightsToDays, buildWeekLedger, collectPlanRecipes, resolveLedgerWeek } from "@/lib/weekLedger";
import PlanWeekNavigation from "./PlanWeekNavigation";
import WeeklyPlanLedger from "./WeeklyPlanLedger";
import WeeklyShoppingSheet from "./WeeklyShoppingSheet";
import { todayForUser } from "@/lib/calendarDate";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function WeekPlanPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const profileId = await requireProfileId();

  const now = new Date();
  const today = todayForUser(now);
  // `?week=` wählt eine vergangene Woche; ohne, ungültig oder in der Zukunft gilt die laufende Woche.
  const { weekStart: monday, isCurrentWeek } = resolveLedgerWeek((await searchParams).week, today);

  // Nacheinander statt parallel: jeder Tag berücksichtigt die Rezepte der Tage davor.
  // Eine vergangene Woche wird nur gelesen: fehlende Tage bleiben null und werden nie nachgeneriert (R5E).
  const weekPlans = await getOrGenerateWeekPlan(profileId, monday, today);
  // Vergangene Tage ohne gespeicherten Plan (null) werden nicht nachgeneriert; der Ledger zeigt sie als Tag ohne Plan.
  const plans = weekPlans.map((plan) => plan ?? { items: [] });
  const ledger = buildWeekLedger({ weekStart: monday, plans, today });
  const recipes = collectPlanRecipes(plans);

  // Insights und Wocheneinkauf betreffen heute und die kommenden Tage - nur in der laufenden Woche.
  // Jedes Insight erscheint im Tag seiner Mahlzeit statt als Block über der ganzen Woche.
  const allInsights = isCurrentWeek ? await getInsightsForProfile(profileId, now) : [];
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
        eyebrow={isCurrentWeek ? "Diese Woche" : "Vergangene Woche"}
        title="Dein Wochenplan"
        intro={ledger.rangeLabel}
        action={isCurrentWeek ? <WeeklyShoppingSheet weekStart={ledger.days[0].key} rangeLabel={ledger.rangeLabel} /> : undefined}
      />

      <PlanWeekNavigation weekStart={monday} isCurrentWeek={isCurrentWeek} />

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
        historicalWeek={!isCurrentWeek}
      />
    </div>
  );
}
