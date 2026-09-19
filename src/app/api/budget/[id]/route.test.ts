import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const updateBudgetAmount = vi.fn();
const deleteBudget = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/budget/budgetService", () => ({
  updateBudgetAmount: (...args: unknown[]) => updateBudgetAmount(...args),
  deleteBudget: (...args: unknown[]) => deleteBudget(...args),
}));

const { PATCH, DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/budget/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: 50 }) });
    const res = await PATCH(req, ctx("budget-1"));
    expect(res.status).toBe(401);
    expect(updateBudgetAmount).not.toHaveBeenCalled();
  });

  it("lehnt eine ungültige Eingabe mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: -1 }) });
    const res = await PATCH(req, ctx("budget-1"));
    expect(res.status).toBe(400);
  });

  it("liefert 404, wenn das Budget nicht dem eigenen Haushalt gehört (nie Daten eines fremden Haushalts)", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    updateBudgetAmount.mockResolvedValueOnce(null);
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: 50 }) });
    const res = await PATCH(req, ctx("budget-of-A"));
    expect(res.status).toBe(404);
    expect(updateBudgetAmount).toHaveBeenCalledWith("household-B", "budget-of-A", expect.objectContaining({ amount: 50 }));
  });

  it("aktualisiert bei gültiger Eingabe und passendem Haushalt", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    updateBudgetAmount.mockResolvedValueOnce({ id: "budget-1", amountCents: 5000 });
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: 50 }) });
    const res = await PATCH(req, ctx("budget-1"));
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/budget/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x"), ctx("budget-1"));
    expect(res.status).toBe(401);
    expect(deleteBudget).not.toHaveBeenCalled();
  });

  it("liefert 404 für ein fremdes Budget, ohne eine ID aus dem Body zu vertrauen", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    deleteBudget.mockResolvedValueOnce(false);
    const res = await DELETE(new Request("http://x"), ctx("budget-of-A"));
    expect(res.status).toBe(404);
    expect(deleteBudget).toHaveBeenCalledWith("household-B", "budget-of-A");
  });

  it("löscht erfolgreich innerhalb des eigenen Haushalts", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    deleteBudget.mockResolvedValueOnce(true);
    const res = await DELETE(new Request("http://x"), ctx("budget-1"));
    expect(res.status).toBe(200);
  });
});
