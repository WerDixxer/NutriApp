import { beforeEach, describe, expect, it, vi } from "vitest";

const getMealPlan = vi.fn();
const getHouseholdRotation = vi.fn();
const pantryItemFindMany = vi.fn();
const foodPriceFindMany = vi.fn();

vi.mock("../mealPlanner/mealPlanService", () => ({
  getMealPlan: (...args: unknown[]) => getMealPlan(...args),
}));

vi.mock("../rotation/rotationService", () => ({
  getHouseholdRotation: (...args: unknown[]) => getHouseholdRotation(...args),
}));

vi.mock("../db", () => ({
  prisma: {
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
    foodPrice: { findMany: (...args: unknown[]) => foodPriceFindMany(...args) },
  },
}));

const { analyzeMealPrep } = await import("./mealPrepService");

function dbMeal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "meal-1",
    date: new Date("2026-09-21"),
    slot: "LUNCH",
    recipeId: "recipe-1",
    portionMultiplier: 1,
    recipe: { name: "Hähnchen Bowl", ingredients: JSON.stringify(["200 g Hähnchenbrust", "150 g Reis"]), prepTimeMin: 25 },
    ...overrides,
  };
}

function dbPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "plan-1",
    startDate: new Date("2026-09-21"),
    endDate: new Date("2026-09-27"),
    meals: [dbMeal()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pantryItemFindMany.mockResolvedValue([]);
  foodPriceFindMany.mockResolvedValue([]);
  getHouseholdRotation.mockResolvedValue({ results: [], useFirst: [], planMeal: [] });
});

describe("analyzeMealPrep: Household-Isolation", () => {
  it("liefert null für einen fremden/nicht existenten Meal Plan (getMealPlan liefert bereits household-scoped null)", async () => {
    getMealPlan.mockResolvedValueOnce(null);
    const result = await analyzeMealPrep("household-B", "plan-of-A");
    expect(result).toBeNull();
    expect(pantryItemFindMany).not.toHaveBeenCalled();
  });

  it("übergibt householdId und mealPlanId unverändert an getMealPlan", async () => {
    getMealPlan.mockResolvedValueOnce(dbPlan());
    await analyzeMealPrep("household-A", "plan-1");
    expect(getMealPlan).toHaveBeenCalledWith("household-A", "plan-1");
  });
});

describe("analyzeMealPrep: Pipeline-Integration", () => {
  it("erzeugt einen vollständigen MealPrepPlan aus zwei sich überschneidenden Rezepten", async () => {
    getMealPlan.mockResolvedValueOnce(
      dbPlan({
        meals: [
          dbMeal({ id: "m1", recipeId: "r1", recipe: { name: "Bowl A", ingredients: JSON.stringify(["200 g Hähnchenbrust"]), prepTimeMin: 20 } }),
          dbMeal({ id: "m2", recipeId: "r2", recipe: { name: "Bowl B", ingredients: JSON.stringify(["300 g Hähnchenbrust"]), prepTimeMin: 30 } }),
        ],
      }),
    );
    const result = await analyzeMealPrep("household-A", "plan-1");
    expect(result).not.toBeNull();
    expect(result!.baselineCookingSessions).toBe(2);
    expect(result!.totalCookingSessions).toBe(1);
    expect(result!.prepGroups[0].tasks[0].totalQuantity).toBe(500);
    expect(result!.prepGroups[0].combinedPrepTimeMin).toBe(50);
  });

  it("nutzt echten Pantry-Bestand, wenn vorhanden", async () => {
    getMealPlan.mockResolvedValueOnce(
      dbPlan({
        meals: [
          dbMeal({ id: "m1", recipeId: "r1", recipe: { name: "Bowl A", ingredients: JSON.stringify(["200 g Hähnchenbrust"]), prepTimeMin: 20 } }),
          dbMeal({ id: "m2", recipeId: "r2", recipe: { name: "Bowl B", ingredients: JSON.stringify(["300 g Hähnchenbrust"]), prepTimeMin: 30 } }),
        ],
      }),
    );
    pantryItemFindMany.mockResolvedValueOnce([{ id: "p1", name: "Hähnchenbrust", remainingQuantity: 150, unit: "G" }]);
    getHouseholdRotation.mockResolvedValueOnce({ results: [{ pantryItemId: "p1", urgency: "HIGH" }], useFirst: [], planMeal: [] });
    const result = await analyzeMealPrep("household-A", "plan-1");
    const withPantry = result!.prepGroups.flatMap((g) => g.tasks).find((t) => t.displayName === "Hähnchenbrust");
    expect(withPantry?.pantry?.availableQuantity).toBe(150);
  });

  it("warnt bei unvollständiger Zutatenstruktur, aber nicht, wenn alles strukturiert erkannt wurde", async () => {
    getMealPlan.mockResolvedValueOnce(
      dbPlan({ meals: [dbMeal({ recipe: { name: "X", ingredients: JSON.stringify(["1 TL Salz", "200 g Hähnchenbrust"]), prepTimeMin: 10 } })] }),
    );
    const result = await analyzeMealPrep("household-A", "plan-1");
    expect(result!.warnings.some((w) => w.code === "INGREDIENT_STRUCTURE_INCOMPLETE")).toBe(true);
  });

  it("warnt bei fehlenden Preisdaten", async () => {
    getMealPlan.mockResolvedValueOnce(dbPlan());
    const result = await analyzeMealPrep("household-A", "plan-1");
    expect(result!.warnings.some((w) => w.code === "NO_PRICE_DATA")).toBe(true);
  });

  it("warnt bei leerem Pantry", async () => {
    getMealPlan.mockResolvedValueOnce(dbPlan());
    const result = await analyzeMealPrep("household-A", "plan-1");
    expect(result!.warnings.some((w) => w.code === "NO_PANTRY_DATA")).toBe(true);
  });
});

describe("analyzeMealPrep: Determinismus", () => {
  it("liefert bei identischem Input dasselbe Ergebnis", async () => {
    const plan = dbPlan({
      meals: [
        dbMeal({ id: "m1", recipeId: "r1", recipe: { name: "Bowl A", ingredients: JSON.stringify(["200 g Hähnchenbrust", "150 g Reis"]), prepTimeMin: 20 } }),
        dbMeal({ id: "m2", recipeId: "r2", recipe: { name: "Bowl B", ingredients: JSON.stringify(["300 g Hähnchenbrust"]), prepTimeMin: 30 } }),
      ],
    });
    getMealPlan.mockResolvedValueOnce(plan);
    const a = await analyzeMealPrep("household-A", "plan-1");
    getMealPlan.mockResolvedValueOnce(plan);
    const b = await analyzeMealPrep("household-A", "plan-1");
    expect(a).toEqual(b);
  });
});

describe("analyzeMealPrep: leerer Meal Plan", () => {
  it("funktioniert mit einem Plan ohne Mahlzeiten, ohne Fehler", async () => {
    getMealPlan.mockResolvedValueOnce(dbPlan({ meals: [] }));
    const result = await analyzeMealPrep("household-A", "plan-1");
    expect(result!.baselineCookingSessions).toBe(0);
    expect(result!.prepGroups).toEqual([]);
  });
});
