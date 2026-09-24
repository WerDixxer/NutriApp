import { beforeEach, describe, expect, it, vi } from "vitest";

const householdMemberFindMany = vi.fn();
const profileFindMany = vi.fn();
const logEntryFindMany = vi.fn();
const recipeFindMany = vi.fn();
const pantryItemFindMany = vi.fn();
const foodBudgetFindMany = vi.fn();
const foodExpenseFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    householdMember: { findMany: (...args: unknown[]) => householdMemberFindMany(...args) },
    profile: { findMany: (...args: unknown[]) => profileFindMany(...args) },
    logEntry: { findMany: (...args: unknown[]) => logEntryFindMany(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    // Kein Food-Katalog und keine strukturierten Zutaten: die Präferenz-Auflösung fällt auf den Textabgleich zurück.
    ingredient: { findMany: async () => [] },
    ingredientAlternative: { findMany: async () => [] },
    recipeIngredient: { findMany: async () => [] },
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
    foodBudget: { findMany: (...args: unknown[]) => foodBudgetFindMany(...args) },
    foodExpense: { findMany: (...args: unknown[]) => foodExpenseFindMany(...args) },
  },
}));

const { buildPlanningContext } = await import("./planningContext");

const now = new Date("2026-09-17T12:00:00");

function dbMember(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: "member-1", userId: "user-1", householdId: "household-A", role: "OWNER", user: { name: "Vincenzo" }, ...overrides };
}

function dbProfile(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "profile-1",
    userId: "user-1",
    age: 27,
    sex: "MALE",
    heightCm: 180,
    weightKg: 80,
    activityLevel: "MODERATE",
    goal: "MAINTAIN",
    goalRateKgPerWeek: 0,
    sportType: "NONE",
    dietType: "OMNIVORE",
    allergies: [],
    likedFoods: [],
    dislikedFoods: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pantryItemFindMany.mockResolvedValue([]);
  foodBudgetFindMany.mockResolvedValue([]);
  recipeFindMany.mockResolvedValue([]);
  logEntryFindMany.mockResolvedValue([]);
});

describe("buildPlanningContext: Household-Isolation", () => {
  it("lädt Mitglieder ausschließlich des übergebenen Haushalts", async () => {
    householdMemberFindMany.mockResolvedValueOnce([]);
    profileFindMany.mockResolvedValueOnce([]);
    await buildPlanningContext("household-A", null, now);
    expect(householdMemberFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ householdId: "household-A" }) }));
  });

  it("filtert zusätzlich nach householdMemberIds, wenn angegeben", async () => {
    householdMemberFindMany.mockResolvedValueOnce([]);
    profileFindMany.mockResolvedValueOnce([]);
    await buildPlanningContext("household-A", ["member-1"], now);
    const call = householdMemberFindMany.mock.calls[0][0];
    expect(call.where.id).toEqual({ in: ["member-1"] });
  });

  it("ignoriert ein Mitglied ohne Profil (kann nicht sinnvoll mitgeplant werden), statt Daten zu erfinden", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember()]);
    profileFindMany.mockResolvedValueOnce([]); // kein Profil für user-1
    const context = await buildPlanningContext("household-A", null, now);
    expect(context.members).toEqual([]);
  });
});

describe("buildPlanningContext: Targets", () => {
  it("berechnet fullDailyTarget und remainingTodayTarget pro Mitglied", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember()]);
    profileFindMany.mockResolvedValueOnce([dbProfile()]);
    const context = await buildPlanningContext("household-A", null, now);
    expect(context.members).toHaveLength(1);
    expect(context.members[0].fullDailyTarget.kcal).toBeGreaterThan(0);
    expect(context.members[0].remainingTodayTarget.kcal).toBeGreaterThan(0);
  });

  it("remainingTodayTarget berücksichtigt bereits geloggte Mahlzeiten (via LogEntry), fullDailyTarget nicht", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember()]);
    profileFindMany.mockResolvedValueOnce([dbProfile()]);
    logEntryFindMany.mockResolvedValueOnce([{ profileId: "profile-1", kcal: 500, proteinG: 30, carbsG: 40, fatG: 10, date: now, recipeId: null }]);
    const context = await buildPlanningContext("household-A", null, now);
    const member = context.members[0];
    expect(member.remainingTodayTarget.kcal).toBe(Math.max(member.fullDailyTarget.kcal - 500, 0));
  });

  it("remainingTodayTarget wird nie negativ (Deckel bei 0), auch bei Überkonsum", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember()]);
    profileFindMany.mockResolvedValueOnce([dbProfile()]);
    logEntryFindMany.mockResolvedValueOnce([{ profileId: "profile-1", kcal: 99999, proteinG: 0, carbsG: 0, fatG: 0, date: now, recipeId: null }]);
    const context = await buildPlanningContext("household-A", null, now);
    expect(context.members[0].remainingTodayTarget.kcal).toBe(0);
  });
});

describe("buildPlanningContext: Kandidaten und Query-Disziplin", () => {
  it("lädt Rezepte für eigene UND von geplanten Mitgliedern erstellte Custom-Rezepte in einer Query", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember()]);
    profileFindMany.mockResolvedValueOnce([dbProfile()]);
    await buildPlanningContext("household-A", null, now);
    expect(recipeFindMany).toHaveBeenCalledTimes(1);
  });

  it("lädt Mitglieder-, Profil-, Log- und Rezept-Queries jeweils genau einmal (kein N+1 über Mitglieder)", async () => {
    householdMemberFindMany.mockResolvedValueOnce([dbMember(), dbMember({ id: "member-2", userId: "user-2" })]);
    profileFindMany.mockResolvedValueOnce([dbProfile(), dbProfile({ id: "profile-2", userId: "user-2" })]);
    await buildPlanningContext("household-A", null, now);
    expect(householdMemberFindMany).toHaveBeenCalledTimes(1);
    expect(profileFindMany).toHaveBeenCalledTimes(1);
    expect(recipeFindMany).toHaveBeenCalledTimes(1);
  });
});
