import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const getBudgetSummary = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/budget/budgetService", () => ({
  getBudgetSummary: (...args: unknown[]) => getBudgetSummary(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/budget/summary: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab, ohne den Service aufzurufen", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getBudgetSummary).not.toHaveBeenCalled();
  });

  it("liefert die Zusammenfassung ausschließlich für den Session-Haushalt, nimmt keine Parameter entgegen", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    getBudgetSummary.mockResolvedValueOnce([{ periodType: "WEEK" }]);
    const res = await GET();
    const body = await res.json();
    expect(getBudgetSummary).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body.summary).toEqual([{ periodType: "WEEK" }]);
  });
});
