import { beforeEach, describe, expect, it, vi } from "vitest";

const profileFindUnique = vi.fn();
const householdMemberFindUnique = vi.fn();
const pantryItemFindMany = vi.fn();
const mealPlanDayFindMany = vi.fn();
const recipeFindMany = vi.fn();
const dismissedInsightFindMany = vi.fn();
const ingredientFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) },
    householdMember: { findUnique: (...args: unknown[]) => householdMemberFindUnique(...args) },
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
    mealPlanDay: { findMany: (...args: unknown[]) => mealPlanDayFindMany(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    dismissedInsight: { findMany: (...args: unknown[]) => dismissedInsightFindMany(...args) },
    // Standard: leerer Food-Katalog (Food-ID-Abgleich ist in enrichment.test.ts abgedeckt).
    ingredient: { findMany: (...args: unknown[]) => ingredientFindMany(...args) },
    ingredientAlternative: { findMany: async () => [] },
  },
}));

const getBudgetSummary = vi.fn();
vi.mock("../budget/budgetService", () => ({
  getBudgetSummary: (...args: unknown[]) => getBudgetSummary(...args),
}));

const { getInsightsForProfile } = await import("./insightService");

const now = new Date("2026-09-18T12:00:00Z");

const baseProfile = { id: "profile-1", userId: "user-1", dietType: "OMNIVORE", allergies: [] };

function expiringPantryItem() {
  return [{ id: "pantry-1", name: "Paprika", remainingQuantity: 2, unit: "PIECE", expirationDate: now }];
}

beforeEach(() => {
  vi.clearAllMocks();
  profileFindUnique.mockResolvedValue(baseProfile);
  householdMemberFindUnique.mockResolvedValue({ householdId: "household-1" });
  pantryItemFindMany.mockResolvedValue([]);
  getBudgetSummary.mockResolvedValue([]);
  mealPlanDayFindMany.mockResolvedValue([]);
  recipeFindMany.mockResolvedValue([]);
  dismissedInsightFindMany.mockResolvedValue([]);
  ingredientFindMany.mockResolvedValue([]);
});

describe("getInsightsForProfile: Rezeptvorschläge und Allergien (F-03)", () => {
  /** Ein Food-Katalog mit nur Skyr (Milch) - so, wie ihn loadFoodCatalog aus der Ingredient-Tabelle liest. */
  const skyrFoodRow = {
    id: "skyr",
    slug: "skyr",
    name: "Skyr",
    category: "dairy",
    dietClass: "vegetarian",
    aliases: "[]",
    allergens: JSON.stringify(["milch"]),
    negligible: false,
    unitGrams: null,
    kcalPer100: 63,
    proteinPer100G: 11,
    carbsPer100G: 4,
    fatPer100G: 0.2,
    fiberPer100G: 0,
    sugarPer100G: 4,
    saturatedFatPer100G: 0.1,
    sodiumPer100Mg: 50,
  };
  /** Eigenes Rezept ohne Allergen-Angabe: nur der Food-Katalog weiß, dass Skyr Milch enthält. */
  const skyrRecipe = {
    id: "custom-skyr",
    name: "Skyr pur",
    dietTypes: JSON.stringify(["OMNIVORE"]),
    allergens: "[]",
    ingredients: JSON.stringify(["300 g Skyr"]),
  };

  beforeEach(() => {
    ingredientFindMany.mockResolvedValue([skyrFoodRow]);
    recipeFindMany.mockResolvedValue([skyrRecipe]);
    pantryItemFindMany.mockResolvedValue([{ id: "pantry-skyr", name: "Skyr", ingredientId: null, remainingQuantity: 500, unit: "G", expirationDate: null }]);
  });

  it("Gegenprobe: ohne Allergie wird das Rezept vorgeschlagen, weil alles im Vorrat ist", async () => {
    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights.map((i) => i.type)).toContain("RECIPE_MATCHES_AVAILABLE_PANTRY");
  });

  it("bei Milchallergie wird das Skyr-Rezept ohne Allergen-Angabe nicht vorgeschlagen", async () => {
    profileFindUnique.mockResolvedValue({ ...baseProfile, allergies: [{ label: "Milch" }] });
    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights.map((i) => i.type)).not.toContain("RECIPE_MATCHES_AVAILABLE_PANTRY");
  });
});

describe("getInsightsForProfile", () => {
  it("liefert eine leere Liste, wenn das Profil keinem Haushalt angehört (keine erfundenen Insights ohne Datengrundlage)", async () => {
    profileFindUnique.mockResolvedValue(baseProfile);
    householdMemberFindUnique.mockResolvedValue(null);
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());

    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(0);
    expect(pantryItemFindMany).not.toHaveBeenCalled();
  });

  it("liefert ein Pantry-Insight, wenn ein Item heute abläuft", async () => {
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());

    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(1);
    expect(insights[0].type).toBe("PANTRY_EXPIRING_SOON");
  });

  it("unterdrückt ein bereits abgewiesenes Insight, obwohl die zugrunde liegende Bedingung weiter zutrifft", async () => {
    pantryItemFindMany.mockResolvedValue(expiringPantryItem());
    const first = await getInsightsForProfile("profile-1", now);
    dismissedInsightFindMany.mockResolvedValue([{ insightKey: first[0].id }]);

    const second = await getInsightsForProfile("profile-1", now);
    expect(second).toHaveLength(0);
  });

  it("liefert keine Insights, wenn es genuinely nichts zu sagen gibt (leerer Vorrat, kein Budget, kein Plan)", async () => {
    const insights = await getInsightsForProfile("profile-1", now);
    expect(insights).toHaveLength(0);
  });

  it("gibt eine leere Liste zurück, wenn kein Profil existiert", async () => {
    profileFindUnique.mockResolvedValue(null);
    const insights = await getInsightsForProfile("missing-profile", now);
    expect(insights).toHaveLength(0);
  });
});
