import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const getMealPlan = vi.fn();
const updateMealPlan = vi.fn();
const deleteMealPlan = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/mealPlanner/mealPlanService", () => ({
  getMealPlan: (...args: unknown[]) => getMealPlan(...args),
  updateMealPlan: (...args: unknown[]) => updateMealPlan(...args),
  deleteMealPlan: (...args: unknown[]) => deleteMealPlan(...args),
}));

const { GET, PATCH, DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/meal-plans/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(401);
    expect(getMealPlan).not.toHaveBeenCalled();
  });

  it("liefert 404 für einen fremden Plan, nie die Daten eines anderen Haushalts", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    getMealPlan.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"), ctx("plan-of-A"));
    expect(res.status).toBe(404);
    expect(getMealPlan).toHaveBeenCalledWith("household-B", "plan-of-A");
  });

  it("liefert den Plan für den eigenen Haushalt", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    getMealPlan.mockResolvedValueOnce({ id: "plan-1" });
    const res = await GET(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(200);
  });
});

describe("PATCH /api/meal-plans/[id]", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }), ctx("plan-1"));
    expect(res.status).toBe(401);
    expect(updateMealPlan).not.toHaveBeenCalled();
  });

  it("lehnt einen ungültigen status mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "DELETED" }) }), ctx("plan-1"));
    expect(res.status).toBe(400);
    expect(updateMealPlan).not.toHaveBeenCalled();
  });

  it("liefert 404 für einen fremden Plan", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    updateMealPlan.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "ARCHIVED" }) }), ctx("plan-of-A"));
    expect(res.status).toBe(404);
  });

  it("aktualisiert den eigenen Plan und meldet archivierte Pläne", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    updateMealPlan.mockResolvedValueOnce({ ok: true, plan: { id: "plan-1", status: "ACTIVE" }, archivedPlanIds: ["plan-0"] });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) }), ctx("plan-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: { id: "plan-1", status: "ACTIVE" }, archivedPlanIds: ["plan-0"] });
    expect(updateMealPlan).toHaveBeenCalledWith("household-A", "plan-1", { status: "ACTIVE" }, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it.each([
    ["INVALID_TRANSITION", "Dieser Statuswechsel ist nicht möglich: Entwürfe können aktiviert, aktive Pläne archiviert werden."],
    ["HISTORICAL_PLAN", "Ein vergangener Entwurf kann nicht mehr aktiviert werden."],
  ])("antwortet auf %s mit 409 und einer verständlichen Meldung", async (error, message) => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    updateMealPlan.mockResolvedValueOnce({ ok: false, error });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ status: "ACTIVE" }) }), ctx("plan-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: message });
  });
});

describe("DELETE /api/meal-plans/[id]", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(401);
    expect(deleteMealPlan).not.toHaveBeenCalled();
  });

  it("liefert 404 für einen fremden/nicht existenten Plan", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-B");
    deleteMealPlan.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    const res = await DELETE(new Request("http://x"), ctx("plan-of-A"));
    expect(res.status).toBe(404);
  });

  it("löscht einen eigenen Entwurf erfolgreich und prüft gegen den heutigen Kalendertag", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    deleteMealPlan.mockResolvedValueOnce({ ok: true });
    const res = await DELETE(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(200);
    expect(deleteMealPlan).toHaveBeenCalledWith("household-A", "plan-1", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("lehnt das Löschen eines nicht löschbaren Plans mit 409 und einer verständlichen Meldung ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    deleteMealPlan.mockResolvedValueOnce({ ok: false, error: "NOT_DELETABLE" });
    const res = await DELETE(new Request("http://x"), ctx("plan-1"));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Löschen lassen sich nur Entwürfe, die heute oder später beginnen; aktive, archivierte und vergangene Pläne bleiben erhalten.",
    });
  });
});
