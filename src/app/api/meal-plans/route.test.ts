import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const listMealPlans = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/mealPlanner/mealPlanService", () => ({
  listMealPlans: (...args: unknown[]) => listMealPlans(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/meal-plans: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listMealPlans).not.toHaveBeenCalled();
  });

  it("liefert Pläne ausschließlich für den Session-Haushalt", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    listMealPlans.mockResolvedValueOnce([{ id: "plan-1" }]);
    const res = await GET();
    const body = await res.json();
    expect(listMealPlans).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body.plans).toEqual([{ id: "plan-1" }]);
  });
});
