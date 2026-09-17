import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const updatePantryItem = vi.fn();
const deletePantryItem = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/pantry/pantryService", () => ({
  updatePantryItem: (...args: unknown[]) => updatePantryItem(...args),
  deletePantryItem: (...args: unknown[]) => deletePantryItem(...args),
}));

const { PATCH, DELETE } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

const validPayload = { name: "Reis", quantity: 1, unit: "KG", expirationDateType: "UNKNOWN", location: "PANTRY" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("PATCH /api/pantry/[id]: Authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(validPayload) }), ctx("item-1"));
    expect(res.status).toBe(401);
    expect(updatePantryItem).not.toHaveBeenCalled();
  });

  it("never trusts a client-supplied householdId: the household comes only from the session", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    updatePantryItem.mockResolvedValueOnce({ id: "item-1" });

    // Selbst wenn der Client versucht, eine fremde Haushalts-ID mitzuschicken, wird sie ignoriert.
    const payload = { ...validPayload, householdId: "household-B" };
    await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(payload) }), ctx("item-1"));

    expect(updatePantryItem).toHaveBeenCalledWith("household-A", "item-1", expect.anything());
  });

  it("returns 404 (not the other household's data) when manipulating the id to target another household's item", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    // pantryService gibt null zurück, weil das Item household-A gehört (siehe pantryService.test.ts).
    updatePantryItem.mockResolvedValueOnce(null);

    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify(validPayload) }),
      ctx("item-of-household-A"),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.item).toBeUndefined();
  });

  it("rejects an invalid payload with 400", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "" }) }), ctx("item-1"));
    expect(res.status).toBe(400);
    expect(updatePantryItem).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/pantry/[id]: Authorization", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx("item-1"));
    expect(res.status).toBe(401);
    expect(deletePantryItem).not.toHaveBeenCalled();
  });

  it("returns 404 when trying to delete another household's item via a manipulated id", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    deletePantryItem.mockResolvedValueOnce(false);

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx("item-of-household-A"));

    expect(res.status).toBe(404);
    expect(deletePantryItem).toHaveBeenCalledWith("household-B", "item-of-household-A");
  });

  it("deletes successfully when the item genuinely belongs to the session's household", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    deletePantryItem.mockResolvedValueOnce(true);

    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx("item-1"));

    expect(res.status).toBe(200);
  });
});
