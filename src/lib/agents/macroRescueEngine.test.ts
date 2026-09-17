import { describe, expect, it, vi } from "vitest";

const profileFindUniqueOrThrow = vi.fn();
const recipeFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    profile: { findUniqueOrThrow: (...args: unknown[]) => profileFindUniqueOrThrow(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
  },
}));

const getRemainingDailyTargetsMock = vi.fn();
vi.mock("./remainingTargets", () => ({
  getRemainingDailyTargets: (...args: unknown[]) => getRemainingDailyTargetsMock(...args),
}));

const { MacroRescueEngine } = await import("./macroRescueEngine");

const baseProfile = { id: "profile-1", dietType: "OMNIVORE", allergies: [] };

function dbRecipe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    name: "Testgericht",
    description: "",
    kcal: 650,
    proteinG: 55,
    carbsG: 60,
    fatG: 18,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: JSON.stringify(["LUNCH"]),
    dietTypes: JSON.stringify(["OMNIVORE"]),
    allergens: JSON.stringify([]),
    ingredients: JSON.stringify([]),
    tags: JSON.stringify([]),
    isTrending: false,
    ...overrides,
  };
}

describe("MacroRescueEngine (integration wrapper)", () => {
  it("nutzt die geteilte getRemainingDailyTargets() statt einer eigenen Berechnung", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe()]);
    getRemainingDailyTargetsMock.mockResolvedValue({ kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 });

    const engine = new MacroRescueEngine();
    await engine.rescue({ profileId: "profile-1" });

    expect(getRemainingDailyTargetsMock).toHaveBeenCalledWith("profile-1", undefined);
  });

  it("verwendet den Tagesrest als Ziel, wenn keine expliziten Vorgaben gemacht wurden", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe({ id: "match", kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 })]);
    getRemainingDailyTargetsMock.mockResolvedValue({ kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 });

    const engine = new MacroRescueEngine();
    const result = await engine.rescue({ profileId: "profile-1" });

    expect(result.targets).toEqual({ calories: 650, protein: 55, carbs: 60, fat: 18, fiber: undefined });
    expect(result.solutions[0].totalLoss).toBe(0);
  });

  it("überschreibt nur die explizit genannten Zielwerte, der Rest bleibt der reale Tagesrest", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe()]);
    getRemainingDailyTargetsMock.mockResolvedValue({ kcal: 2000, proteinG: 55, carbsG: 60, fatG: 18 });

    const engine = new MacroRescueEngine();
    const result = await engine.rescue({ profileId: "profile-1", targetsOverride: { calories: 300 } });

    expect(result.targets.calories).toBe(300);
    expect(result.targets.protein).toBe(55);
  });

  it("erlaubt das Überschreiben einzelner Toleranzen, der Rest bleibt der Standard", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe()]);
    getRemainingDailyTargetsMock.mockResolvedValue({ kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 });

    const engine = new MacroRescueEngine();
    const result = await engine.rescue({ profileId: "profile-1", tolerances: { caloriesPct: 0.01 } });

    expect(result.tolerances.caloriesPct).toBe(0.01);
    expect(result.tolerances.proteinPct).toBeGreaterThan(0.01);
  });

  it("liefert eine leere Lösungsliste ohne Fehler, wenn kein Kandidat vorhanden ist", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([]);
    getRemainingDailyTargetsMock.mockResolvedValue({ kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 });

    const engine = new MacroRescueEngine();
    await expect(engine.rescue({ profileId: "profile-1" })).resolves.toMatchObject({ solutions: [] });
  });
});
