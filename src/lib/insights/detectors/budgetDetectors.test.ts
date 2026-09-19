import { describe, expect, it } from "vitest";
import { detectBudgetInsights, type BudgetInsightEntry } from "./budgetDetectors";

const now = new Date("2026-09-18T12:00:00Z");
const periodStart = new Date("2026-09-14T00:00:00Z");

function entry(overrides: Partial<BudgetInsightEntry> = {}): BudgetInsightEntry {
  return {
    budgetId: "budget-1",
    periodType: "WEEK",
    currency: "EUR",
    spentAmountCents: 0,
    remainingAmountCents: 6000,
    spentPercentage: 0,
    status: "UNDER_BUDGET",
    periodStart,
    ...overrides,
  };
}

describe("detectBudgetInsights", () => {
  it("meldet Überschreitung als important", () => {
    const insights = detectBudgetInsights([entry({ status: "OVER_BUDGET", spentAmountCents: 7000, remainingAmountCents: -1000 })], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe("BUDGET_OVER");
    expect(insights[0].priority).toBe("important");
    expect(insights[0].message).toContain("10,00 €");
  });

  it("meldet Annäherung ans Limit als useful", () => {
    const insights = detectBudgetInsights([entry({ status: "NEAR_LIMIT", spentAmountCents: 5000, remainingAmountCents: 1000 })], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe("BUDGET_NEAR_LIMIT");
    expect(insights[0].priority).toBe("useful");
  });

  it("meldet 'noch Spielraum' nur, wenn tatsächlich schon etwas ausgegeben wurde", () => {
    const noSpending = detectBudgetInsights([entry({ status: "UNDER_BUDGET", spentAmountCents: 0 })], now);
    expect(noSpending).toHaveLength(0);

    const withSpending = detectBudgetInsights([entry({ status: "UNDER_BUDGET", spentAmountCents: 3000, remainingAmountCents: 1200 })], now);
    expect(withSpending).toHaveLength(1);
    expect(withSpending[0].type).toBe("BUDGET_UNDER_WITH_ROOM");
    expect(withSpending[0].priority).toBe("informational");
    expect(withSpending[0].message).toContain("12,00 €");
  });

  it("erzeugt für einen neuen Perioden-Start eine andere id (alte Ablehnung unterdrückt nicht die neue Periode)", () => {
    const week1 = detectBudgetInsights([entry({ status: "OVER_BUDGET", spentAmountCents: 7000, remainingAmountCents: -1000, periodStart })], now);
    const nextWeek = new Date(periodStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const week2 = detectBudgetInsights(
      [entry({ status: "OVER_BUDGET", spentAmountCents: 7000, remainingAmountCents: -1000, periodStart: nextWeek })],
      now,
    );
    expect(week1[0].id).not.toBe(week2[0].id);
  });
});
