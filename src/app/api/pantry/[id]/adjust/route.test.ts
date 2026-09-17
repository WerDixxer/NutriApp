import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const adjustPantryItemQuantity = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/pantry/pantryService", () => ({
  adjustPantryItemQuantity: (...args: unknown[]) => adjustPantryItemQuantity(...args),
}));

const { POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/pantry/[id]/adjust: Authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ type: "add", amount: 1 }) }), ctx("item-1"));
    expect(res.status).toBe(401);
    expect(adjustPantryItemQuantity).not.toHaveBeenCalled();
  });

  it("rejects a negative amount with 400", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ type: "add", amount: -5 }) }),
      ctx("item-1"),
    );
    expect(res.status).toBe(400);
    expect(adjustPantryItemQuantity).not.toHaveBeenCalled();
  });

  it("returns 404 when adjusting another household's item via a manipulated id", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    adjustPantryItemQuantity.mockResolvedValueOnce(null);

    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ type: "consume", amount: 100 }) }),
      ctx("item-of-household-A"),
    );

    expect(res.status).toBe(404);
    expect(adjustPantryItemQuantity).toHaveBeenCalledWith("household-B", "item-of-household-A", { type: "consume", amount: 100 });
  });

  it("applies the adjustment for an item genuinely belonging to the session's household", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    adjustPantryItemQuantity.mockResolvedValueOnce({ id: "item-1", remainingQuantity: 300 });

    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ type: "consume", amount: 200 }) }),
      ctx("item-1"),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.item.remainingQuantity).toBe(300);
  });
});
