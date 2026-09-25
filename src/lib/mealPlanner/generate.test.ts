import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarDate } from "../calendarDate";

const buildPlanningContext = vi.fn();
const generateMealPlan = vi.fn();
const validateGeneratedPlan = vi.fn();
const createMealPlan = vi.fn();

vi.mock("./planningContext", () => ({ buildPlanningContext: (...args: unknown[]) => buildPlanningContext(...args) }));
vi.mock("./plannerEngine", () => ({ generateMealPlan: (...args: unknown[]) => generateMealPlan(...args) }));
vi.mock("./validatePlan", () => ({ validateGeneratedPlan: (...args: unknown[]) => validateGeneratedPlan(...args) }));
vi.mock("./mealPlanService", () => ({ createMealPlan: (...args: unknown[]) => createMealPlan(...args) }));

const { generateAndSaveMealPlan } = await import("./generate");

const now = new Date("2026-09-17T12:00:00");
const TODAY: CalendarDate = "2026-09-17";
const baseRequest: Parameters<typeof generateAndSaveMealPlan>[0] = {
  householdId: "household-A",
  householdMemberIds: null,
  startDate: TODAY,
  days: 7,
  slots: ["BREAKFAST", "LUNCH", "DINNER"],
};

function ctxWithMembers(count = 1) {
  return { householdId: "household-A", members: Array.from({ length: count }, (_, i) => ({ householdMemberId: `member-${i}` })) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateAndSaveMealPlan: keine Mitglieder", () => {
  it("liefert NO_VALID_PLAN ohne zu planen oder zu speichern, wenn der Kontext keine Mitglieder liefert", async () => {
    buildPlanningContext.mockResolvedValueOnce({ householdId: "household-A", members: [] });
    const result = await generateAndSaveMealPlan(baseRequest, now);
    expect(result.status).toBe("NO_VALID_PLAN");
    expect(generateMealPlan).not.toHaveBeenCalled();
    expect(createMealPlan).not.toHaveBeenCalled();
  });
});

describe("generateAndSaveMealPlan: NO_VALID_PLAN aus der Engine wird nicht gespeichert", () => {
  it("speichert nichts, wenn die Engine selbst NO_VALID_PLAN liefert", async () => {
    buildPlanningContext.mockResolvedValueOnce(ctxWithMembers());
    generateMealPlan.mockReturnValueOnce({ status: "NO_VALID_PLAN", meals: [], unmetSlots: [] });
    const result = await generateAndSaveMealPlan(baseRequest, now);
    expect(result.status).toBe("NO_VALID_PLAN");
    expect(validateGeneratedPlan).not.toHaveBeenCalled();
    expect(createMealPlan).not.toHaveBeenCalled();
  });
});

describe("generateAndSaveMealPlan: Validierungsfehler verhindert das Speichern", () => {
  it("speichert NICHTS, wenn die letzte Validierung einen Fehler findet, selbst wenn die Engine SUCCESS meldete", async () => {
    buildPlanningContext.mockResolvedValueOnce(ctxWithMembers());
    generateMealPlan.mockReturnValueOnce({ status: "SUCCESS", meals: [{ recipeId: "r1" }], unmetSlots: [] });
    validateGeneratedPlan.mockReturnValueOnce([{ meal: {}, message: "Verletzt Hard Constraints: Test" }]);
    const result = await generateAndSaveMealPlan(baseRequest, now);
    expect(result.status).toBe("NO_VALID_PLAN");
    expect(result.validationErrors).toEqual(["Verletzt Hard Constraints: Test"]);
    expect(createMealPlan).not.toHaveBeenCalled();
  });
});

describe("generateAndSaveMealPlan: erfolgreicher Pfad", () => {
  it("speichert SUCCESS-Pläne als ACTIVE", async () => {
    buildPlanningContext.mockResolvedValueOnce(ctxWithMembers());
    generateMealPlan.mockReturnValueOnce({ status: "SUCCESS", meals: [], unmetSlots: [] });
    validateGeneratedPlan.mockReturnValueOnce([]);
    createMealPlan.mockResolvedValueOnce({ id: "plan-1" });
    const result = await generateAndSaveMealPlan(baseRequest, now);
    expect(result.status).toBe("SUCCESS");
    expect(createMealPlan).toHaveBeenCalledWith("household-A", expect.objectContaining({ status: "ACTIVE" }));
  });

  it("speichert PARTIAL-Pläne als DRAFT, nicht als ACTIVE", async () => {
    buildPlanningContext.mockResolvedValueOnce(ctxWithMembers());
    generateMealPlan.mockReturnValueOnce({ status: "PARTIAL", meals: [], unmetSlots: [{ date: TODAY, slot: "DINNER", reason: "x" }] });
    validateGeneratedPlan.mockReturnValueOnce([]);
    createMealPlan.mockResolvedValueOnce({ id: "plan-1" });
    const result = await generateAndSaveMealPlan(baseRequest, now);
    expect(result.status).toBe("PARTIAL");
    expect(createMealPlan).toHaveBeenCalledWith("household-A", expect.objectContaining({ status: "DRAFT" }));
  });

  it("übergibt dem Service die householdMemberIds aus dem tatsächlichen Planning Context, nicht ungeprüft aus dem Request", async () => {
    buildPlanningContext.mockResolvedValueOnce(ctxWithMembers(2));
    generateMealPlan.mockReturnValueOnce({ status: "SUCCESS", meals: [], unmetSlots: [] });
    validateGeneratedPlan.mockReturnValueOnce([]);
    createMealPlan.mockResolvedValueOnce({ id: "plan-1" });
    await generateAndSaveMealPlan(baseRequest, now);
    expect(createMealPlan).toHaveBeenCalledWith("household-A", expect.objectContaining({ householdMemberIds: ["member-0", "member-1"] }));
  });
});
