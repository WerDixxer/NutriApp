import { beforeEach, describe, expect, it, vi } from "vitest";

const mealPlanDayFindMany = vi.fn();
const pantryItemFindMany = vi.fn();
const getHouseholdIdForProfile = vi.fn();
const getHouseholdRotation = vi.fn();

// Bewusst NUR lesende Prisma-Methoden und kein `mealPlan`/`mealPlanDay.create`:
// ein Schreibzugriff oder ein Zugriff auf den Haushalts-Planer würde hier abstürzen.
vi.mock("../db", () => ({
  prisma: {
    mealPlanDay: { findMany: (...args: unknown[]) => mealPlanDayFindMany(...args) },
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
  },
}));

vi.mock("../household", () => ({
  getHouseholdIdForProfile: (...args: unknown[]) => getHouseholdIdForProfile(...args),
}));

vi.mock("../rotation/rotationService", () => ({
  getHouseholdRotation: (...args: unknown[]) => getHouseholdRotation(...args),
}));

const { getWeeklyShoppingForProfile, weekRangeFor } = await import("./weeklyShoppingService");

function day(date: Date, items: { id: string; recipeName: string; ingredients: string[]; portionMultiplier?: number }[]) {
  return {
    id: `day-${date.getDate()}`,
    date,
    items: items.map((item) => ({
      id: item.id,
      slot: "LUNCH",
      recipeId: `recipe-${item.id}`,
      portionMultiplier: item.portionMultiplier ?? 1,
      recipe: { name: item.recipeName, ingredients: JSON.stringify(item.ingredients) },
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mealPlanDayFindMany.mockResolvedValue([]);
  pantryItemFindMany.mockResolvedValue([]);
  getHouseholdIdForProfile.mockResolvedValue("household-1");
  getHouseholdRotation.mockResolvedValue({ results: [], useFirst: [], planMeal: [] });
});

describe("weekRangeFor", () => {
  it("liefert Montag bis Sonntag der Woche, die das Datum enthält", () => {
    const { start, end } = weekRangeFor(new Date(2026, 8, 23, 15, 30)); // Mittwoch
    expect(start).toEqual(new Date(2026, 8, 21));
    expect(end).toEqual(new Date(2026, 8, 27));
  });

  it("ordnet Montag und Sonntag derselben Woche zu", () => {
    expect(weekRangeFor(new Date(2026, 8, 21)).start).toEqual(new Date(2026, 8, 21));
    expect(weekRangeFor(new Date(2026, 8, 27)).start).toEqual(new Date(2026, 8, 21));
  });

  it("überspringt Monatsgrenzen korrekt", () => {
    const { start, end } = weekRangeFor(new Date(2026, 9, 1)); // Donnerstag, 1. Oktober
    expect(start).toEqual(new Date(2026, 8, 28));
    expect(end).toEqual(new Date(2026, 9, 4));
  });
});

describe("getWeeklyShoppingForProfile: Planquelle", () => {
  it("liest die MealPlanDay-Zeilen des Profils für genau diese Woche und erzeugt keine", async () => {
    await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 23));

    expect(mealPlanDayFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { profileId: "profile-1", date: { gte: new Date(2026, 8, 21), lte: new Date(2026, 8, 27) } } }),
    );
  });

  it("aggregiert über alle Tage der Woche und zieht den Haushalts-Vorrat danach einmal ab", async () => {
    mealPlanDayFindMany.mockResolvedValue([
      day(new Date(2026, 8, 21), [{ id: "i1", recipeName: "Montag", ingredients: ["4 Stück Tomaten"] }]),
      day(new Date(2026, 8, 23), [{ id: "i2", recipeName: "Mittwoch", ingredients: ["2 Stück Tomaten"] }]),
      day(new Date(2026, 8, 25), [{ id: "i3", recipeName: "Freitag", ingredients: ["2 Stück Tomaten", "1 EL Öl"] }]),
    ]);
    pantryItemFindMany.mockResolvedValue([{ id: "p1", name: "Tomaten", remainingQuantity: 3, unit: "PIECE" }]);
    getHouseholdRotation.mockResolvedValue({ results: [{ pantryItemId: "p1", urgency: "HIGH" }], useFirst: [], planMeal: [] });

    const result = await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 23));

    expect(pantryItemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { householdId: "household-1" } }));
    expect(result.weekStart).toEqual(new Date(2026, 8, 21));
    expect(result.weekEnd).toEqual(new Date(2026, 8, 27));
    expect(result.plannedDays).toBe(3);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      ingredientName: "Tomaten",
      requiredQuantity: 8,
      availableQuantity: 3,
      missingQuantity: 5,
      recipeCount: 3,
      urgency: "HIGH",
    });
    expect(result.unresolvedIngredients).toEqual([{ raw: "1 EL Öl", recipeNames: ["Freitag"], occurrences: 1 }]);
  });

  it("wendet den Portionsfaktor des Plan-Eintrags an", async () => {
    mealPlanDayFindMany.mockResolvedValue([
      day(new Date(2026, 8, 21), [{ id: "i1", recipeName: "Bowl", ingredients: ["200 g Reis"], portionMultiplier: 1.5 }]),
    ]);
    const result = await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 21));
    expect(result.items[0].requiredQuantity).toBe(300);
  });

  it("zählt Tage ohne Plan-Einträge nicht als geplant", async () => {
    mealPlanDayFindMany.mockResolvedValue([
      day(new Date(2026, 8, 21), [{ id: "i1", recipeName: "Bowl", ingredients: ["200 g Reis"] }]),
      day(new Date(2026, 8, 22), []),
    ]);
    const result = await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 21));
    expect(result.plannedDays).toBe(1);
  });

  it("liefert für eine Woche ohne Plan ein leeres Ergebnis", async () => {
    const result = await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 21));
    expect(result).toMatchObject({ plannedDays: 0, items: [], unresolvedIngredients: [] });
  });
});

describe("getWeeklyShoppingForProfile: Vorrat", () => {
  it("behandelt den Vorrat ohne Haushalt als leer und fragt ihn gar nicht ab", async () => {
    getHouseholdIdForProfile.mockResolvedValue(null);
    mealPlanDayFindMany.mockResolvedValue([
      day(new Date(2026, 8, 21), [{ id: "i1", recipeName: "Bowl", ingredients: ["200 g Reis"] }]),
    ]);

    const result = await getWeeklyShoppingForProfile("profile-1", new Date(2026, 8, 21));

    expect(pantryItemFindMany).not.toHaveBeenCalled();
    expect(getHouseholdRotation).not.toHaveBeenCalled();
    expect(result.items[0]).toMatchObject({ requiredQuantity: 200, availableQuantity: 0, missingQuantity: 200 });
  });
});
