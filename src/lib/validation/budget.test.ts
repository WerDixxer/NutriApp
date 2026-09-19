import { describe, expect, it } from "vitest";
import { createExpenseSchema, expenseRangeQuerySchema, setBudgetSchema, updateBudgetSchema } from "./budget";

describe("setBudgetSchema", () => {
  it("akzeptiert eine gültige Eingabe", () => {
    const result = setBudgetSchema.safeParse({ periodType: "WEEK", amount: 60 });
    expect(result.success).toBe(true);
  });

  it("lehnt einen negativen Betrag ab", () => {
    const result = setBudgetSchema.safeParse({ periodType: "WEEK", amount: -10 });
    expect(result.success).toBe(false);
  });

  it("lehnt einen Betrag von 0 ab", () => {
    const result = setBudgetSchema.safeParse({ periodType: "WEEK", amount: 0 });
    expect(result.success).toBe(false);
  });

  it("lehnt einen unrealistisch hohen Betrag ab", () => {
    const result = setBudgetSchema.safeParse({ periodType: "WEEK", amount: 999999 });
    expect(result.success).toBe(false);
  });

  it("lehnt einen ungültigen periodType ab", () => {
    const result = setBudgetSchema.safeParse({ periodType: "YEAR", amount: 60 });
    expect(result.success).toBe(false);
  });

  it("lehnt eine andere Währung als EUR ab (v1 unterstützt keine Umrechnung)", () => {
    const result = setBudgetSchema.safeParse({ periodType: "WEEK", amount: 60, currency: "USD" });
    expect(result.success).toBe(false);
  });

  it("verwendet EUR als Default-Währung", () => {
    const result = setBudgetSchema.parse({ periodType: "WEEK", amount: 60 });
    expect(result.currency).toBe("EUR");
  });
});

describe("updateBudgetSchema", () => {
  it("verlangt nur einen gültigen Betrag", () => {
    expect(updateBudgetSchema.safeParse({ amount: 45 }).success).toBe(true);
    expect(updateBudgetSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});

describe("createExpenseSchema", () => {
  it("akzeptiert eine vollständige gültige Eingabe", () => {
    const result = createExpenseSchema.safeParse({
      amount: 19.87,
      date: "2026-09-17",
      category: "GROCERIES",
      source: "Supermarkt",
      description: "Wocheneinkauf",
    });
    expect(result.success).toBe(true);
  });

  it("erlaubt source/description wegzulassen", () => {
    const result = createExpenseSchema.safeParse({ amount: 5, date: "2026-09-17" });
    expect(result.success).toBe(true);
  });

  it("lehnt eine negative Ausgabe ab", () => {
    const result = createExpenseSchema.safeParse({ amount: -5, date: "2026-09-17" });
    expect(result.success).toBe(false);
  });

  it("lehnt eine Ausgabe ohne Datum ab", () => {
    const result = createExpenseSchema.safeParse({ amount: 5 });
    expect(result.success).toBe(false);
  });

  it("verwendet GROCERIES als Default-Kategorie", () => {
    const result = createExpenseSchema.parse({ amount: 5, date: "2026-09-17" });
    expect(result.category).toBe("GROCERIES");
  });

  it("lehnt eine ungültige Kategorie ab", () => {
    const result = createExpenseSchema.safeParse({ amount: 5, date: "2026-09-17", category: "LUXURY" });
    expect(result.success).toBe(false);
  });
});

describe("expenseRangeQuerySchema", () => {
  it("erlaubt beide Parameter wegzulassen", () => {
    expect(expenseRangeQuerySchema.safeParse({}).success).toBe(true);
  });

  it("koerziert gültige ISO-Datumsstrings", () => {
    const result = expenseRangeQuerySchema.parse({ from: "2026-09-01", to: "2026-09-30" });
    expect(result.from).toBeInstanceOf(Date);
    expect(result.to).toBeInstanceOf(Date);
  });
});
