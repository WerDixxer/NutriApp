import { describe, expect, it } from "vitest";
import { calculateBudgetStatus } from "./budgetCalculation";

const start = new Date("2026-09-14T00:00:00.000Z");
const end = new Date("2026-09-20T23:59:59.999Z");

describe("calculateBudgetStatus: Status-Einordnung", () => {
  it("UNDER_BUDGET bei deutlich unter dem Limit liegenden Ausgaben", () => {
    const result = calculateBudgetStatus(6000, 2000, start, end);
    expect(result.status).toBe("UNDER_BUDGET");
  });

  it("NEAR_LIMIT ab 80% des Budgets", () => {
    const result = calculateBudgetStatus(6000, 4800, start, end);
    expect(result.status).toBe("NEAR_LIMIT");
  });

  it("bleibt UNDER_BUDGET knapp unter der 80%-Schwelle", () => {
    const result = calculateBudgetStatus(6000, 4799, start, end);
    expect(result.status).toBe("UNDER_BUDGET");
  });

  it("OVER_BUDGET, sobald die Ausgaben das Budget übersteigen", () => {
    const result = calculateBudgetStatus(6000, 6001, start, end);
    expect(result.status).toBe("OVER_BUDGET");
  });

  it("gilt bei exakt erreichtem Budget (100%) noch als NEAR_LIMIT, nicht OVER_BUDGET", () => {
    const result = calculateBudgetStatus(6000, 6000, start, end);
    expect(result.status).toBe("NEAR_LIMIT");
  });
});

describe("calculateBudgetStatus: Beträge und Prozentwerte", () => {
  it("berechnet remainingAmountCents korrekt", () => {
    const result = calculateBudgetStatus(6000, 2000, start, end);
    expect(result.remainingAmountCents).toBe(4000);
  });

  it("remainingAmountCents wird bei Overspend negativ, nicht auf 0 geklemmt", () => {
    const result = calculateBudgetStatus(6000, 7500, start, end);
    expect(result.remainingAmountCents).toBe(-1500);
  });

  it("berechnet spentPercentage korrekt", () => {
    const result = calculateBudgetStatus(6000, 3000, start, end);
    expect(result.spentPercentage).toBe(50);
  });

  it("spentPercentage kann über 100 gehen (Overspend), wird nicht künstlich gedeckelt", () => {
    const result = calculateBudgetStatus(6000, 9000, start, end);
    expect(result.spentPercentage).toBe(150);
  });

  it("remainingPercentage kann negativ werden (Overspend)", () => {
    const result = calculateBudgetStatus(6000, 9000, start, end);
    expect(result.remainingPercentage).toBe(-50);
  });

  it("gibt periodStart/periodEnd unverändert zurück", () => {
    const result = calculateBudgetStatus(6000, 3000, start, end);
    expect(result.periodStart).toBe(start);
    expect(result.periodEnd).toBe(end);
  });
});

describe("calculateBudgetStatus: Zero-Budget Edge Cases", () => {
  it("ein Budget von 0 ohne Ausgaben gilt als UNDER_BUDGET, nicht als Fehler", () => {
    const result = calculateBudgetStatus(0, 0, start, end);
    expect(result.status).toBe("UNDER_BUDGET");
    expect(result.spentPercentage).toBe(0);
  });

  it("ein Budget von 0 mit jeder Ausgabe > 0 ist sofort OVER_BUDGET", () => {
    const result = calculateBudgetStatus(0, 500, start, end);
    expect(result.status).toBe("OVER_BUDGET");
    expect(result.remainingAmountCents).toBe(-500);
  });

  it("spentPercentage bei Budget 0 und Ausgaben > 0 wird nicht als Infinity zurückgegeben", () => {
    const result = calculateBudgetStatus(0, 500, start, end);
    expect(Number.isFinite(result.spentPercentage)).toBe(true);
  });
});

describe("calculateBudgetStatus: keine Bewertung im Sinne einer Nutzerkritik", () => {
  it("die zurückgegebenen Status-Werte sind rein faktisch, keine wertenden Freitexte enthalten", () => {
    const result = calculateBudgetStatus(6000, 9000, start, end);
    expect(["UNDER_BUDGET", "NEAR_LIMIT", "OVER_BUDGET"]).toContain(result.status);
  });
});
