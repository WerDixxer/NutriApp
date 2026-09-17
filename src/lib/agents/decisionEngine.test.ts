import { beforeEach, describe, expect, it, vi } from "vitest";

const profileFindUniqueOrThrow = vi.fn();
const profileFindUnique = vi.fn();
const recipeFindMany = vi.fn();
const logEntryFindMany = vi.fn();
const pantryItemFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    profile: {
      findUniqueOrThrow: (...args: unknown[]) => profileFindUniqueOrThrow(...args),
      findUnique: (...args: unknown[]) => profileFindUnique(...args),
    },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    logEntry: { findMany: (...args: unknown[]) => logEntryFindMany(...args) },
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
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

function dbPantryItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pantry-1",
    name: "Reis",
    opened: false,
    cooked: false,
    quantity: 1,
    remainingQuantity: 1,
    expirationDate: null,
    expirationDateType: "UNKNOWN",
    purchaseDate: null,
    location: "OTHER",
    ...overrides,
  };
}

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
  beforeEach(() => {
    // Standard: kein Haushalt gefunden, Pantry-Faktor bleibt neutral, kein Crash.
    profileFindUnique.mockResolvedValue(null);
    pantryItemFindMany.mockResolvedValue([]);
  });

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

  it("berücksichtigt vorhandene Pantry-Zutaten des Haushalts, ohne dass der Nutzer sie in der Nachricht nennen muss", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    profileFindUnique.mockResolvedValue({ user: { householdMembership: { householdId: "household-1" } } });
    pantryItemFindMany.mockResolvedValue([dbPantryItem({ name: "Reis" })]);
    recipeFindMany.mockResolvedValue([
      dbRecipe({ id: "with-rice", ingredients: JSON.stringify(["200 g Reis"]) }),
      dbRecipe({ id: "without-rice", ingredients: JSON.stringify(["200 g Nudeln"]) }),
    ]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1" });

    expect(result?.recipeId).toBe("with-rice");
    expect(result?.reasons.some((r) => r.includes("bereits hast"))).toBe(true);
  });

  it("bevorzugt ein Rezept, das ein bald ablaufendes Pantry Item verwertet (echter Food-Waste-Faktor, Kapitel 7)", async () => {
    profileFindUniqueOrThrow.mockResolvedValue(baseProfile);
    profileFindUnique.mockResolvedValue({ user: { householdMembership: { householdId: "household-1" } } });
    pantryItemFindMany.mockResolvedValue([
      dbPantryItem({ id: "urgent-spinach", name: "Spinat", expirationDate: new Date(), expirationDateType: "EXACT" }),
    ]);
    recipeFindMany.mockResolvedValue([
      dbRecipe({ id: "uses-spinach", ingredients: JSON.stringify(["200 g Spinat"]) }),
      dbRecipe({ id: "unrelated", ingredients: JSON.stringify(["200 g Nudeln"]) }),
    ]);
    logEntryFindMany.mockResolvedValue([]);

    const engine = new MultiFactorDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1" });

    expect(result?.recipeId).toBe("uses-spinach");
    expect(result?.reasons.some((r) => r.includes("bald ablaufen"))).toBe(true);
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
