import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiHouseholdId = vi.fn();
const generateAndSaveMealPlan = vi.fn();
const householdMemberFindMany = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiHouseholdId: (...args: unknown[]) => getApiHouseholdId(...args),
}));

vi.mock("@/lib/mealPlanner/generate", () => ({
  generateAndSaveMealPlan: (...args: unknown[]) => generateAndSaveMealPlan(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: { householdMember: { findMany: (...args: unknown[]) => householdMemberFindMany(...args) } },
}));

const { POST } = await import("./route");

const validBody = { startDate: "2026-09-21", days: 7, mealTypes: ["BREAKFAST", "LUNCH", "DINNER"] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/meal-plans/generate: Authorization und Validierung", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(validBody) }));
    expect(res.status).toBe(401);
    expect(generateAndSaveMealPlan).not.toHaveBeenCalled();
  });

  it("lehnt eine ungültige Eingabe mit 400 ab", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ startDate: "2026-09-21", days: 0, mealTypes: [] }) }));
    expect(res.status).toBe(400);
    expect(generateAndSaveMealPlan).not.toHaveBeenCalled();
  });
});

describe("POST /api/meal-plans/generate: memberIds werden serverseitig gegen den Haushalt geprüft", () => {
  it("lehnt eine memberId ab, die nicht zum aktuellen Haushalt gehört", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    householdMemberFindMany.mockResolvedValueOnce([]); // keiner der angegebenen IDs gehört zum Haushalt
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ ...validBody, memberIds: ["member-of-household-B"] }) }),
    );
    expect(res.status).toBe(400);
    expect(generateAndSaveMealPlan).not.toHaveBeenCalled();
  });

  it("prüft memberIds ausschließlich gegen den Session-Haushalt (nie einen im Body übergebenen)", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    householdMemberFindMany.mockResolvedValueOnce([{ id: "member-1" }]);
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "SUCCESS", plan: { id: "plan-1" }, unmetSlots: [] });
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...validBody, memberIds: ["member-1"] }) }));
    expect(householdMemberFindMany).toHaveBeenCalledWith({ where: { householdId: "household-A", id: { in: ["member-1"] } }, select: { id: true } });
  });

  it("akzeptiert das Fehlen von memberIds (Standardkontext = ganzer Haushalt)", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "SUCCESS", plan: { id: "plan-1" }, unmetSlots: [] });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(validBody) }));
    expect(res.status).toBe(200);
    expect(householdMemberFindMany).not.toHaveBeenCalled();
    expect(generateAndSaveMealPlan).toHaveBeenCalledWith(expect.objectContaining({ householdMemberIds: null }));
  });
});

describe("POST /api/meal-plans/generate: Ergebnis-Status", () => {
  it("liefert bei NO_VALID_PLAN 200 mit einer ehrlichen Fehlermeldung statt eines generischen Fehlers", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "NO_VALID_PLAN", plan: null, unmetSlots: [], validationErrors: [] });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify(validBody) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("NO_VALID_PLAN");
    expect(body.message).toMatch(/kein vollständiger Plan/);
  });

  it("übergibt die Session-householdId, nie eine aus dem Body", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "SUCCESS", plan: { id: "plan-1" }, unmetSlots: [] });
    await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ ...validBody, householdId: "household-FOREIGN" }) }));
    expect(generateAndSaveMealPlan).toHaveBeenCalledWith(expect.objectContaining({ householdId: "household-A" }));
  });
});
