import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const listBudgets = vi.fn();
const setBudget = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/budget/budgetService", () => ({
  listBudgets: (...args: unknown[]) => listBudgets(...args),
  setBudget: (...args: unknown[]) => setBudget(...args),
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/budget: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab, ohne den Service aufzurufen", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listBudgets).not.toHaveBeenCalled();
  });

  it("liefert Budgets ausschließlich für den aus der Session abgeleiteten Haushalt", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    listBudgets.mockResolvedValueOnce([{ id: "b1" }]);
    const res = await GET();
    const body = await res.json();
    expect(listBudgets).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body.budgets).toEqual([{ id: "b1" }]);
  });
});

describe("POST /api/budget: Authorization und Validierung", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const req = new Request("http://x/api/budget", { method: "POST", body: JSON.stringify({ periodType: "WEEK", amount: 60 }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(setBudget).not.toHaveBeenCalled();
  });

  it("lehnt eine ungültige Eingabe mit 400 ab, ohne den Service aufzurufen", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const req = new Request("http://x/api/budget", { method: "POST", body: JSON.stringify({ periodType: "WEEK", amount: -5 }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(setBudget).not.toHaveBeenCalled();
  });

  it("übergibt dem Service ausschließlich die aus der Session abgeleitete householdId, nie eine aus dem Body", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    setBudget.mockResolvedValueOnce({ id: "b1", periodType: "WEEK" });
    const req = new Request("http://x/api/budget", {
      method: "POST",
      body: JSON.stringify({ periodType: "WEEK", amount: 60, householdId: "household-FOREIGN" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(setBudget).toHaveBeenCalledWith("household-A", expect.objectContaining({ periodType: "WEEK", amount: 60 }));
  });
});
