import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const updateExpense = vi.fn();
const deleteExpense = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/budget/budgetService", () => ({
  updateExpense: (...args: unknown[]) => updateExpense(...args),
  deleteExpense: (...args: unknown[]) => deleteExpense(...args),
}));

const { PATCH, DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/budget/expenses/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: 10, date: "2026-09-17" }) });
    const res = await PATCH(req, ctx("e1"));
    expect(res.status).toBe(401);
    expect(updateExpense).not.toHaveBeenCalled();
  });

  it("liefert 404 für eine fremde Ausgabe, statt sie zu ändern", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    updateExpense.mockResolvedValueOnce(null);
    const req = new Request("http://x", { method: "PATCH", body: JSON.stringify({ amount: 10, date: "2026-09-17" }) });
    const res = await PATCH(req, ctx("expense-of-A"));
    expect(res.status).toBe(404);
    expect(updateExpense).toHaveBeenCalledWith("household-B", "expense-of-A", expect.objectContaining({ amount: 10 }));
  });
});

describe("DELETE /api/budget/expenses/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x"), ctx("e1"));
    expect(res.status).toBe(401);
    expect(deleteExpense).not.toHaveBeenCalled();
  });

  it("liefert 404, wenn die Ausgabe nicht existiert oder einem anderen Haushalt gehört", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    deleteExpense.mockResolvedValueOnce(false);
    const res = await DELETE(new Request("http://x"), ctx("expense-of-A"));
    expect(res.status).toBe(404);
    expect(deleteExpense).toHaveBeenCalledWith("household-B", "expense-of-A");
  });

  it("löscht erfolgreich innerhalb des eigenen Haushalts", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    deleteExpense.mockResolvedValueOnce(true);
    const res = await DELETE(new Request("http://x"), ctx("e1"));
    expect(res.status).toBe(200);
  });
});
