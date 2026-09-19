import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const listExpenses = vi.fn();
const createExpense = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/budget/budgetService", () => ({
  listExpenses: (...args: unknown[]) => listExpenses(...args),
  createExpense: (...args: unknown[]) => createExpense(...args),
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/budget/expenses: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x/api/budget/expenses"));
    expect(res.status).toBe(401);
    expect(listExpenses).not.toHaveBeenCalled();
  });

  it("liefert Ausgaben ausschließlich für den Session-Haushalt, ohne Range standardmäßig", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    listExpenses.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://x/api/budget/expenses"));
    expect(res.status).toBe(200);
    expect(listExpenses).toHaveBeenCalledWith("household-A", { from: undefined, to: undefined });
  });

  it("reicht from/to Query-Parameter validiert weiter", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    listExpenses.mockResolvedValueOnce([]);
    const res = await GET(new Request("http://x/api/budget/expenses?from=2026-09-01&to=2026-09-30"));
    expect(res.status).toBe(200);
    const call = listExpenses.mock.calls[0][1];
    expect(call.from).toBeInstanceOf(Date);
    expect(call.to).toBeInstanceOf(Date);
  });

  it("lehnt einen ungültigen Query-Parameter mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await GET(new Request("http://x/api/budget/expenses?from=nicht-ein-datum"));
    expect(res.status).toBe(400);
    expect(listExpenses).not.toHaveBeenCalled();
  });
});

describe("POST /api/budget/expenses: Authorization und Validierung", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ amount: 10, date: "2026-09-17" }) });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("lehnt eine negative Ausgabe mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const req = new Request("http://x", { method: "POST", body: JSON.stringify({ amount: -5, date: "2026-09-17" }) });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("legt die Ausgabe ausschließlich für den Session-Haushalt an", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    createExpense.mockResolvedValueOnce({ id: "e1" });
    const req = new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ amount: 10, date: "2026-09-17", householdId: "household-FOREIGN" }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(createExpense).toHaveBeenCalledWith("household-A", expect.objectContaining({ amount: 10 }));
  });
});
