import { beforeEach, describe, expect, it, vi } from "vitest";

const foodBudgetFindMany = vi.fn();
const foodBudgetUpsert = vi.fn();
const foodBudgetFindFirst = vi.fn();
const foodBudgetUpdate = vi.fn();
const foodBudgetDeleteMany = vi.fn();
const foodExpenseFindMany = vi.fn();
const foodExpenseCreate = vi.fn();
const foodExpenseFindFirst = vi.fn();
const foodExpenseUpdate = vi.fn();
const foodExpenseDeleteMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    foodBudget: {
      findMany: (...args: unknown[]) => foodBudgetFindMany(...args),
      upsert: (...args: unknown[]) => foodBudgetUpsert(...args),
      findFirst: (...args: unknown[]) => foodBudgetFindFirst(...args),
      update: (...args: unknown[]) => foodBudgetUpdate(...args),
      deleteMany: (...args: unknown[]) => foodBudgetDeleteMany(...args),
    },
    foodExpense: {
      findMany: (...args: unknown[]) => foodExpenseFindMany(...args),
      create: (...args: unknown[]) => foodExpenseCreate(...args),
      findFirst: (...args: unknown[]) => foodExpenseFindFirst(...args),
      update: (...args: unknown[]) => foodExpenseUpdate(...args),
      deleteMany: (...args: unknown[]) => foodExpenseDeleteMany(...args),
    },
  },
}));

const {
  listBudgets,
  setBudget,
  updateBudgetAmount,
  deleteBudget,
  listExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  getBudgetSummary,
} = await import("./budgetService");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listBudgets: Household-Isolation", () => {
  it("fragt ausschließlich Budgets des übergebenen Haushalts ab", async () => {
    foodBudgetFindMany.mockResolvedValueOnce([]);
    await listBudgets("household-A");
    expect(foodBudgetFindMany).toHaveBeenCalledWith({ where: { householdId: "household-A" }, orderBy: { periodType: "asc" } });
  });
});

describe("setBudget: Upsert-Verhalten", () => {
  it("upsertet über den zusammengesetzten (householdId, periodType)-Schlüssel, nie über eine freie id", async () => {
    foodBudgetUpsert.mockResolvedValueOnce({ id: "b1" });
    await setBudget("household-A", { periodType: "WEEK", amount: 60, currency: "EUR" });
    expect(foodBudgetUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId_periodType: { householdId: "household-A", periodType: "WEEK" } },
      }),
    );
  });

  it("rechnet den Euro-Betrag vor dem Schreiben deterministisch in Cent um", async () => {
    foodBudgetUpsert.mockResolvedValueOnce({ id: "b1" });
    await setBudget("household-A", { periodType: "WEEK", amount: 19.87, currency: "EUR" });
    const call = foodBudgetUpsert.mock.calls[0][0];
    expect(call.create.amountCents).toBe(1987);
    expect(call.update.amountCents).toBe(1987);
  });
});

describe("updateBudgetAmount: Authorization", () => {
  it("gibt null zurück, wenn das Budget nicht zum Haushalt gehört (kein Leak, kein Update)", async () => {
    foodBudgetFindFirst.mockResolvedValueOnce(null);
    const result = await updateBudgetAmount("household-B", "budget-of-A", { amount: 50 });
    expect(result).toBeNull();
    expect(foodBudgetUpdate).not.toHaveBeenCalled();
  });

  it("prüft id UND householdId gemeinsam in einer Query, nicht id allein", async () => {
    foodBudgetFindFirst.mockResolvedValueOnce({ id: "budget-1" });
    foodBudgetUpdate.mockResolvedValueOnce({ id: "budget-1", amountCents: 5000 });
    await updateBudgetAmount("household-A", "budget-1", { amount: 50 });
    expect(foodBudgetFindFirst).toHaveBeenCalledWith({ where: { id: "budget-1", householdId: "household-A" } });
  });
});

describe("deleteBudget: Authorization", () => {
  it("löscht nur, wenn id und householdId gemeinsam matchen", async () => {
    foodBudgetDeleteMany.mockResolvedValueOnce({ count: 0 });
    const result = await deleteBudget("household-B", "budget-of-A");
    expect(result).toBe(false);
    expect(foodBudgetDeleteMany).toHaveBeenCalledWith({ where: { id: "budget-of-A", householdId: "household-B" } });
  });
});

describe("listExpenses: Datumsfilter", () => {
  it("filtert ohne Range-Parameter gar nicht nach Datum", async () => {
    foodExpenseFindMany.mockResolvedValueOnce([]);
    await listExpenses("household-A");
    expect(foodExpenseFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-A" },
      orderBy: { date: "desc" },
      take: 200,
    });
  });

  it("wendet from/to als Datumsfilter an, wenn angegeben", async () => {
    foodExpenseFindMany.mockResolvedValueOnce([]);
    const from = new Date("2026-09-01");
    const to = new Date("2026-09-30");
    await listExpenses("household-A", { from, to });
    expect(foodExpenseFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-A", date: { gte: from, lte: to } },
      orderBy: { date: "desc" },
      take: 200,
    });
  });
});

describe("createExpense", () => {
  it("rechnet den Betrag vor dem Schreiben in Cent um und hängt den Haushalt an", async () => {
    foodExpenseCreate.mockResolvedValueOnce({ id: "e1" });
    await createExpense("household-A", {
      amount: 12.5,
      currency: "EUR",
      date: new Date("2026-09-17"),
      category: "GROCERIES",
    });
    const call = foodExpenseCreate.mock.calls[0][0];
    expect(call.data.householdId).toBe("household-A");
    expect(call.data.amountCents).toBe(1250);
  });
});

describe("updateExpense / deleteExpense: Authorization", () => {
  it("updateExpense gibt null zurück für eine fremde Ausgabe", async () => {
    foodExpenseFindFirst.mockResolvedValueOnce(null);
    const result = await updateExpense("household-B", "expense-of-A", {
      amount: 10,
      currency: "EUR",
      date: new Date("2026-09-17"),
      category: "GROCERIES",
    });
    expect(result).toBeNull();
    expect(foodExpenseUpdate).not.toHaveBeenCalled();
  });

  it("deleteExpense löscht nur innerhalb des eigenen Haushalts", async () => {
    foodExpenseDeleteMany.mockResolvedValueOnce({ count: 1 });
    const result = await deleteExpense("household-A", "expense-1");
    expect(result).toBe(true);
    expect(foodExpenseDeleteMany).toHaveBeenCalledWith({ where: { id: "expense-1", householdId: "household-A" } });
  });
});

describe("getBudgetSummary: Aggregation ohne unnötige Queries", () => {
  it("gibt eine leere Liste zurück, wenn kein Budget gesetzt ist, ohne die Ausgaben-Query auszuführen", async () => {
    foodBudgetFindMany.mockResolvedValueOnce([]);
    const summary = await getBudgetSummary("household-A");
    expect(summary).toEqual([]);
    expect(foodExpenseFindMany).not.toHaveBeenCalled();
  });

  it("lädt Ausgaben für WEEK und MONTH gemeinsam in genau einer Query, nicht einer pro Budget", async () => {
    foodBudgetFindMany.mockResolvedValueOnce([
      { id: "b-week", householdId: "household-A", periodType: "WEEK", amountCents: 6000, currency: "EUR" },
      { id: "b-month", householdId: "household-A", periodType: "MONTH", amountCents: 25000, currency: "EUR" },
    ]);
    foodExpenseFindMany.mockResolvedValueOnce([]);
    await getBudgetSummary("household-A", new Date("2026-09-17T12:00:00"));
    expect(foodExpenseFindMany).toHaveBeenCalledTimes(1);
  });

  it("ordnet Ausgaben korrekt der jeweiligen Periode zu und summiert sie", async () => {
    const now = new Date("2026-09-17T12:00:00");
    foodBudgetFindMany.mockResolvedValueOnce([
      { id: "b-week", householdId: "household-A", periodType: "WEEK", amountCents: 6000, currency: "EUR" },
    ]);
    foodExpenseFindMany.mockResolvedValueOnce([
      { amountCents: 1000, date: new Date("2026-09-15") }, // innerhalb der Woche
      { amountCents: 500, date: new Date("2026-08-01") }, // weit außerhalb
    ]);
    const summary = await getBudgetSummary("household-A", now);
    expect(summary).toHaveLength(1);
    expect(summary[0].spentAmountCents).toBe(1000);
  });

  it("funktioniert korrekt ohne jegliche Ausgaben in der Periode", async () => {
    foodBudgetFindMany.mockResolvedValueOnce([
      { id: "b-week", householdId: "household-A", periodType: "WEEK", amountCents: 6000, currency: "EUR" },
    ]);
    foodExpenseFindMany.mockResolvedValueOnce([]);
    const summary = await getBudgetSummary("household-A", new Date("2026-09-17T12:00:00"));
    expect(summary[0].spentAmountCents).toBe(0);
    expect(summary[0].status).toBe("UNDER_BUDGET");
  });
});
