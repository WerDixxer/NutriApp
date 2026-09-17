import { describe, expect, it, vi } from "vitest";

const profileFindUniqueOrThrow = vi.fn();
const recipeFindMany = vi.fn();
const logEntryFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    profile: { findUniqueOrThrow: (...args: unknown[]) => profileFindUniqueOrThrow(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    logEntry: { findMany: (...args: unknown[]) => logEntryFindMany(...args) },
  },
}));

const { MultiFactorDecisionEngine } = await import("./decisionEngine");

const baseProfile = {
  id: "profile-1",
  sex: "MALE",
  weightKg: 80,
  heightCm: 180,
  age: 30,
  activityLevel: "MODERATE",
  goal: "MAINTAIN",
  goalRateKgPerWeek: 0,
  sportType: "MIXED",
  dietType: "OMNIVORE",
  allergies: [],
  likedFoods: [],
  dislikedFoods: [],
};

function dbRecipe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "r1",
    name: "Testgericht",
    description: "Ein Testgericht.",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: JSON.stringify(["LUNCH"]),
    dietTypes: JSON.stringify(["OMNIVORE"]),
    allergens: JSON.stringify([]),
    ingredients: JSON.stringify(["200 g Reis", "150 g Hähnchen"]),
    tags: JSON.stringify([]),
    isTrending: false,
    ...overrides,
  };
}

describe("MultiFactorDecisionEngine (integration wrapper)", () => {
  it("wählt ein konkretes Rezept anhand der realen Tagesreste, ohne Fehler bei fehlenden Pantry-Daten", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe()]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1" });

    expect(result).not.toBeNull();
    expect(result?.recipeId).toBe("r1");
    // Kein Crash trotz fehlender Pantry-Angabe, reasons bleibt ein gültiges Array (ggf. leer, nie erfunden).
    expect(Array.isArray(result?.reasons)).toBe(true);
  });

  it("nutzt genannte Pantry-Zutaten (aus der Nachricht) sobald vorhanden, als echten Score-Faktor", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([
      dbRecipe({ id: "with-rice", ingredients: JSON.stringify(["200 g Reis"]) }),
      dbRecipe({ id: "without-rice", ingredients: JSON.stringify(["200 g Nudeln"]) }),
    ]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1", query: { ingredients: ["Reis"] } });

    expect(result?.recipeId).toBe("with-rice");
    expect(result?.reasons.some((r) => r.includes("bereits hast"))).toBe(true);
  });

  it("gibt null zurück, wenn kein Kandidat die Hard Constraints besteht (sauberer Fallback, kein Fehler)", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([dbRecipe({ dietTypes: JSON.stringify(["VEGAN"]) })]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    await expect(engine.decide({ profileId: "profile-1" })).resolves.toBeNull();
  });

  it("übernimmt explizit genannte Kalorien aus der Anfrage als Zielwert", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    recipeFindMany.mockResolvedValue([
      dbRecipe({ id: "small", kcal: 300 }),
      dbRecipe({ id: "matches-query", kcal: 900 }),
    ]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1", query: { calories: 900 } });

    expect(result?.recipeId).toBe("matches-query");
  });
});
