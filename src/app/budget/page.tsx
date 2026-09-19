import { requireHouseholdId, requireProfileId } from "@/lib/session";
import { getBudgetSummary, listExpenses } from "@/lib/budget/budgetService";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getInsightsForProfile } from "@/lib/insights/insightService";
import { forSurface } from "@/lib/insights/dedupe";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
import BudgetClient, { type BudgetSummaryView, type ExpenseView } from "./BudgetClient";

export default async function BudgetPage() {
  const householdId = await requireHouseholdId();
  const profileId = await requireProfileId();
  const [summary, expenses] = await Promise.all([getBudgetSummary(householdId), listExpenses(householdId)]);

  const allInsights = await getInsightsForProfile(profileId);
  // Kein Link "Budget ansehen" hier - wir sind bereits auf /budget.
  const insights: InsightView[] = forSurface(allInsights, "BUDGET").map((i) => ({
    id: i.id,
    message: i.message,
    priority: i.priority,
    action: i.action?.href === "/budget" ? undefined : i.action,
  }));

  const summaryViews: BudgetSummaryView[] = summary.map((s) => ({
    budgetId: s.budgetId,
    periodType: s.periodType,
    currency: s.currency,
    budgetAmountCents: s.budgetAmountCents,
    spentAmountCents: s.spentAmountCents,
    remainingAmountCents: s.remainingAmountCents,
    spentPercentage: s.spentPercentage,
    status: s.status,
    periodStart: s.periodStart.toISOString(),
    periodEnd: s.periodEnd.toISOString(),
  }));

  const expenseViews: ExpenseView[] = expenses.map((e) => ({
    id: e.id,
    amountCents: e.amountCents,
    currency: e.currency,
    date: e.date.toISOString(),
    category: e.category,
    source: e.source,
    description: e.description,
  }));

  return (
    <div>
      <SectionHeader
        eyebrow="Budget"
        title="Dein Lebensmittelbudget"
        intro="Wochen- und Monatsausgaben auf einen Blick. Alle Beträge basieren auf tatsächlich erfassten Ausgaben, nie auf Schätzungen."
      />
      {insights.length > 0 && (
        <div className="mt-8">
          <InsightsPanel initialInsights={insights} />
        </div>
      )}
      <div className="mt-10">
        <BudgetClient initialSummary={summaryViews} initialExpenses={expenseViews} />
      </div>
    </div>
  );
}
