import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const analyzeMealPrep = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/mealPrep/mealPrepService", () => ({
  analyzeMealPrep: (...args: unknown[]) => analyzeMealPrep(...args),
}));

const { GET } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/meal-plans/[id]/meal-prep: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(401);
    expect(analyzeMealPrep).not.toHaveBeenCalled();
  });

  it("liefert 404 für einen fremden/nicht existenten Meal Plan, nie Daten eines anderen Haushalts", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    analyzeMealPrep.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"), ctx("plan-of-A"));
    expect(res.status).toBe(404);
    expect(analyzeMealPrep).toHaveBeenCalledWith("household-B", "plan-of-A", "BALANCED");
  });

  it("verwendet ausschließlich die aus der Session abgeleitete householdId", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    analyzeMealPrep.mockResolvedValueOnce({ mealPlanId: "plan-1" });
    await GET(new Request("http://x?householdId=household-FOREIGN"), ctx("plan-1"));
    expect(analyzeMealPrep).toHaveBeenCalledWith("household-A", "plan-1", "BALANCED");
  });
});

describe("GET /api/meal-plans/[id]/meal-prep: Strategie-Parameter", () => {
  it("lehnt eine ungültige Strategie mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await GET(new Request("http://x?strategy=FASTEST"), ctx("plan-1"));
    expect(res.status).toBe(400);
    expect(analyzeMealPrep).not.toHaveBeenCalled();
  });

  it("reicht eine gültige Strategie weiter", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    analyzeMealPrep.mockResolvedValueOnce({ mealPlanId: "plan-1" });
    await GET(new Request("http://x?strategy=MIN_COOKING"), ctx("plan-1"));
    expect(analyzeMealPrep).toHaveBeenCalledWith("household-A", "plan-1", "MIN_COOKING");
  });

  it("liefert bei Erfolg 200 mit dem Analyse-Ergebnis", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    analyzeMealPrep.mockResolvedValueOnce({ mealPlanId: "plan-1", totalCookingSessions: 2 });
    const res = await GET(new Request("http://x"), ctx("plan-1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.mealPrep.totalCookingSessions).toBe(2);
  });
});
