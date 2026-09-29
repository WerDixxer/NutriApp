import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

/** Serveruhr der Tests: Montag, 21.09.2026, 10:00 Uhr in Berlin. "Heute" ist damit der 21.09. */
const SERVER_NOW = new Date("2026-09-21T10:00:00+02:00");
const validBody = { startDate: "2026-09-21", days: 7, mealTypes: ["BREAKFAST", "LUNCH", "DINNER"] };

function generateRequest(body: unknown): Request {
  return new Request("http://x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(SERVER_NOW);
});

afterEach(() => {
  vi.useRealTimers();
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
    expect(generateAndSaveMealPlan).toHaveBeenCalledWith(expect.objectContaining({ householdMemberIds: null }), expect.any(Date));
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
    expect(generateAndSaveMealPlan).toHaveBeenCalledWith(expect.objectContaining({ householdId: "household-A" }), expect.any(Date));
  });
});

describe("POST /api/meal-plans/generate: Start nicht in der Vergangenheit (R5E)", () => {
  it("lehnt einen Start vor heute mit 400 ab, ohne zu planen oder den Haushalt abzufragen", async () => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    const res = await POST(generateRequest({ ...validBody, startDate: "2026-09-20", memberIds: ["member-1"] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Ein Essensplan kann nicht in der Vergangenheit beginnen." });
    expect(generateAndSaveMealPlan).not.toHaveBeenCalled();
    expect(householdMemberFindMany).not.toHaveBeenCalled();
  });

  it.each([
    ["heute", "2026-09-21"],
    ["in der Zukunft", "2026-09-25"],
  ])("erlaubt einen Start %s und plant mit demselben Zeitpunkt, mit dem geprüft wurde", async (_label, startDate) => {
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "SUCCESS", plan: { id: "plan-1" }, unmetSlots: [] });

    const res = await POST(generateRequest({ ...validBody, startDate }));

    expect(res.status).toBe(200);
    expect(generateAndSaveMealPlan).toHaveBeenCalledWith(expect.objectContaining({ startDate }), SERVER_NOW);
  });

  it("entscheidet nach dem deutschen Kalendertag des Servers, nicht nach dem Datum des Browsers", async () => {
    // 00:30 Uhr am 22.09. in Berlin: Ein Browser, der nach UTC rechnet, hält noch den 21.09. für heute.
    vi.setSystemTime(new Date("2026-09-22T00:30:00+02:00"));
    getApiHouseholdId.mockResolvedValueOnce("household-A");

    const res = await POST(generateRequest({ ...validBody, startDate: "2026-09-21" }));

    expect(res.status).toBe(400);
    expect(generateAndSaveMealPlan).not.toHaveBeenCalled();
  });

  it("erlaubt kurz vor Mitternacht in Berlin noch den laufenden Tag", async () => {
    vi.setSystemTime(new Date("2026-09-21T23:30:00+02:00"));
    getApiHouseholdId.mockResolvedValueOnce("household-A");
    generateAndSaveMealPlan.mockResolvedValueOnce({ status: "SUCCESS", plan: { id: "plan-1" }, unmetSlots: [] });

    const res = await POST(generateRequest({ ...validBody, startDate: "2026-09-21" }));

    expect(res.status).toBe(200);
  });
});
