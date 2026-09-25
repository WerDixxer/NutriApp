import { beforeEach, describe, expect, it, vi } from "vitest";

const mealPlanFindMany = vi.fn();
const mealPlanFindFirst = vi.fn();
const mealPlanCreate = vi.fn();
const mealPlanUpdate = vi.fn();
const mealPlanDeleteMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    mealPlan: {
      findMany: (...args: unknown[]) => mealPlanFindMany(...args),
      findFirst: (...args: unknown[]) => mealPlanFindFirst(...args),
      create: (...args: unknown[]) => mealPlanCreate(...args),
      update: (...args: unknown[]) => mealPlanUpdate(...args),
      deleteMany: (...args: unknown[]) => mealPlanDeleteMany(...args),
    },
  },
}));

const { listMealPlans, getMealPlan, createMealPlan, updateMealPlan, deleteMealPlan } = await import("./mealPlanService");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listMealPlans / getMealPlan: Household-Isolation", () => {
  it("listMealPlans fragt ausschließlich Pläne des übergebenen Haushalts ab", async () => {
    mealPlanFindMany.mockResolvedValueOnce([]);
    await listMealPlans("household-A");
    expect(mealPlanFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "household-A" } }));
  });

  it("getMealPlan prüft id UND householdId gemeinsam", async () => {
    mealPlanFindFirst.mockResolvedValueOnce(null);
    const result = await getMealPlan("household-B", "plan-of-A");
    expect(result).toBeNull();
    expect(mealPlanFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "plan-of-A", householdId: "household-B" } }));
  });
});

describe("createMealPlan: verschachtelte, atomare Persistierung", () => {
  it("erstellt Plan, Mitglieder und Mahlzeiten in einem einzigen verschachtelten create()", async () => {
    mealPlanCreate.mockResolvedValueOnce({ id: "plan-1" });
    await createMealPlan("household-A", {
      startDate: "2026-09-21",
      endDate: "2026-09-27",
      householdMemberIds: ["member-1", "member-2"],
      meals: [{ date: "2026-09-21", slot: "LUNCH", recipeId: "recipe-1", recipeName: "X", portionMultiplier: 1.2, reasons: ["Test-Grund"] }],
      status: "ACTIVE",
    });
    expect(mealPlanCreate).toHaveBeenCalledTimes(1);
    const createCall = mealPlanCreate.mock.calls[0][0];
    expect(createCall.data.householdId).toBe("household-A");
    expect(createCall.data.members.create).toEqual([{ householdMemberId: "member-1" }, { householdMemberId: "member-2" }]);
    expect(createCall.data.meals.create[0].reasons).toBe(JSON.stringify(["Test-Grund"]));
    expect(createCall.data.meals.create[0].portionMultiplier).toBe(1.2);
    // Kalendertage werden als UTC-Mitternacht gespeichert, das Planende ist der letzte Tag selbst (F-10).
    expect(createCall.data.startDate).toEqual(new Date("2026-09-21T00:00:00.000Z"));
    expect(createCall.data.endDate).toEqual(new Date("2026-09-27T00:00:00.000Z"));
    expect(createCall.data.meals.create[0].date).toEqual(new Date("2026-09-21T00:00:00.000Z"));
  });
});

describe("updateMealPlan: Authorization", () => {
  it("gibt null zurück für einen fremden Plan, ohne zu schreiben", async () => {
    mealPlanFindFirst.mockResolvedValueOnce(null);
    const result = await updateMealPlan("household-B", "plan-of-A", { status: "ARCHIVED" });
    expect(result).toBeNull();
    expect(mealPlanUpdate).not.toHaveBeenCalled();
  });

  it("aktualisiert nur die übergebenen Felder", async () => {
    mealPlanFindFirst.mockResolvedValueOnce({ id: "plan-1" });
    mealPlanUpdate.mockResolvedValueOnce({ id: "plan-1", status: "ARCHIVED" });
    await updateMealPlan("household-A", "plan-1", { status: "ARCHIVED" });
    expect(mealPlanUpdate).toHaveBeenCalledWith({ where: { id: "plan-1" }, data: { status: "ARCHIVED" } });
  });
});

describe("deleteMealPlan: Authorization", () => {
  it("löscht nur, wenn id und householdId gemeinsam matchen", async () => {
    mealPlanDeleteMany.mockResolvedValueOnce({ count: 0 });
    const result = await deleteMealPlan("household-B", "plan-of-A");
    expect(result).toBe(false);
    expect(mealPlanDeleteMany).toHaveBeenCalledWith({ where: { id: "plan-of-A", householdId: "household-B" } });
  });
});
