import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const listPantryItems = vi.fn();
const createPantryItem = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/pantry/pantryService", () => ({
  listPantryItems: (...args: unknown[]) => listPantryItems(...args),
  createPantryItem: (...args: unknown[]) => createPantryItem(...args),
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

const validPayload = { name: "Reis", quantity: 1, unit: "KG", expirationDateType: "UNKNOWN", location: "PANTRY" };

describe("GET /api/pantry", () => {
  it("rejects an unauthenticated request with 401, without ever calling the service", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listPantryItems).not.toHaveBeenCalled();
  });

  it("only ever lists items for the household resolved from the session, never a client-supplied id", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    listPantryItems.mockResolvedValueOnce([{ id: "item-1" }]);

    const res = await GET();
    const body = await res.json();

    expect(listPantryItems).toHaveBeenCalledWith("household-A");
    expect(body.items).toEqual([{ id: "item-1" }]);
  });
});

describe("POST /api/pantry", () => {
  it("rejects an unauthenticated request with 401", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x/api/pantry", { method: "POST", body: JSON.stringify(validPayload) }));
    expect(res.status).toBe(401);
    expect(createPantryItem).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload with 400 before touching the service", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(new Request("http://x/api/pantry", { method: "POST", body: JSON.stringify({ name: "" }) }));
    expect(res.status).toBe(400);
    expect(createPantryItem).not.toHaveBeenCalled();
  });

  it("creates the item scoped to the session's household", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    createPantryItem.mockResolvedValueOnce({ id: "item-1" });

    const res = await POST(new Request("http://x/api/pantry", { method: "POST", body: JSON.stringify(validPayload) }));

    expect(res.status).toBe(200);
    expect(createPantryItem).toHaveBeenCalledWith("household-A", expect.objectContaining({ name: "Reis" }));
  });
});

describe("POST /api/pantry: Request-Body (F-19)", () => {
  it.each([
    ["kaputtem JSON", "{kaputt"],
    ["leerem Body", ""],
  ])("antwortet bei %s mit 400 statt 500 und legt nichts an", async (_label, body) => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(new Request("http://x/api/pantry", { method: "POST", body }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("kein gültiges JSON");
    expect(createPantryItem).not.toHaveBeenCalled();
  });

  it("leitet ein leeres Objekt weiterhin an die Schema-Prüfung weiter (nicht als kaputtes JSON)", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(new Request("http://x/api/pantry", { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain("kein gültiges JSON");
  });
});
