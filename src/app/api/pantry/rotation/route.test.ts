import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const getHouseholdRotation = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/rotation/rotationService", () => ({
  getHouseholdRotation: (...args: unknown[]) => getHouseholdRotation(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/pantry/rotation: Authorization", () => {
  it("rejects an unauthenticated request with 401, without ever calling the service", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getHouseholdRotation).not.toHaveBeenCalled();
  });

  it("returns rotation data only for the household resolved from the session, never a client-supplied id", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    getHouseholdRotation.mockResolvedValueOnce({ results: [], useFirst: [], planMeal: [] });

    const res = await GET();
    const body = await res.json();

    expect(getHouseholdRotation).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body).toEqual({ results: [], useFirst: [], planMeal: [] });
  });

  it("never exposes another household's data: the route has no way to accept a foreign householdId", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    getHouseholdRotation.mockResolvedValueOnce({ results: [{ pantryItemId: "b-item" }], useFirst: [], planMeal: [] });

    // Selbst wenn ein Client versucht, per Query-Parameter eine fremde householdId zu übergeben,
    // liest die Route sie nie: GET() nimmt bewusst keine Parameter entgegen.
    const res = await GET();
    const body = await res.json();

    expect(getHouseholdRotation).toHaveBeenCalledWith("household-B");
    expect(body.results).toEqual([{ pantryItemId: "b-item" }]);
  });
});
