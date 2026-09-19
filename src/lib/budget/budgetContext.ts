import { getBudgetSummary } from "./budgetService";

/**
 * Vorbereitete Schnittstelle für Kapitel 13 (Decision Engine soll SPÄTER
 * Budget berücksichtigen können, siehe softScoring.ts:scoreBudget). Diese
 * Kapitel-8-Lieferung verdrahtet den Faktor bewusst NOCH NICHT in die
 * Decision Engine, sondern stellt nur den Kontext bereit, den ein künftiger
 * scoreBudget() bräuchte. `remainingBudgetCents: null` bedeutet "kein
 * aktives Budget für diesen Haushalt", nie 0 (0 wäre eine erfundene Aussage
 * über ein tatsächlich nicht gesetztes Budget).
 */
export interface BudgetContext {
  remainingWeekBudgetCents: number | null;
  remainingMonthBudgetCents: number | null;
}

export async function getBudgetContextForHousehold(householdId: string, now: Date = new Date()): Promise<BudgetContext> {
  const summary = await getBudgetSummary(householdId, now);
  const week = summary.find((s) => s.periodType === "WEEK");
  const month = summary.find((s) => s.periodType === "MONTH");
  return {
    remainingWeekBudgetCents: week ? week.remainingAmountCents : null,
    remainingMonthBudgetCents: month ? month.remainingAmountCents : null,
  };
}
