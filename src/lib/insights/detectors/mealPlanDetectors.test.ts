import { describe, expect, it } from "vitest";
import {
  detectMealFullyCovered,
  detectMealIngredientExpiresBeforeMeal,
  detectMealMissingIngredients,
  type MealPlanInsightItem,
  type PantryInsightStock,
} from "./mealPlanDetectors";

const now = new Date("2026-09-18T12:00:00Z"); // Freitag

function meal(overrides: Partial<MealPlanInsightItem> = {}): MealPlanInsightItem {
  return {
    id: "meal-1",
    date: now,
    slot: "DINNER",
    recipeId: "recipe-1",
    recipeName: "Hähnchen-Curry",
    ingredients: ["200 g Hähnchenbrust", "100 g Reis"],
    portionMultiplier: 1,
    ...overrides,
  };
}

function pantryItem(overrides: Partial<PantryInsightStock> = {}): PantryInsightStock {
  return {
    id: "pantry-1",
    name: "Hähnchenbrust",
    remainingQuantity: 500,
    unit: "G",
    expirationDate: null,
    ...overrides,
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

describe("detectMealMissingIngredients", () => {
  it("meldet eine heute geplante Mahlzeit mit fehlender Zutat", () => {
    const insights = detectMealMissingIngredients([meal()], [], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("important");
    expect(insights[0].message).toContain("Hähnchen-Curry");
  });

  it("meldet NICHTS, wenn alle strukturierten Zutaten ausreichend vorhanden sind", () => {
    const pantry = [pantryItem({ name: "Hähnchenbrust", remainingQuantity: 500 }), pantryItem({ id: "p2", name: "Reis", remainingQuantity: 500 })];
    const insights = detectMealMissingIngredients([meal()], pantry, now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS, wenn fast die ganze Mahlzeit fehlt - das ist bei den meisten Rezepten trivial wahr, keine echte Information", () => {
    const bigRecipe = meal({
      ingredients: ["200 g Hähnchenbrust", "100 g Reis", "50 g Erdnüsse", "20 g Ingwer"],
    });
    // Nichts davon im Vorrat -> 4 fehlende Zutaten, über dem Schwellenwert.
    const insights = detectMealMissingIngredients([bigRecipe], [], now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für eine Mahlzeit, die nicht heute stattfindet", () => {
    const insights = detectMealMissingIngredients([meal({ date: addDays(now, 3) })], [], now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für ein Rezept ohne eine einzige strukturiert erkennbare Zutatenzeile", () => {
    const insights = detectMealMissingIngredients([meal({ ingredients: ["Salz, Pfeffer"] })], [], now);
    expect(insights).toHaveLength(0);
  });
});

describe("detectMealFullyCovered", () => {
  it("meldet eine heute geplante Mahlzeit als vollständig gedeckt, wenn der Vorrat ausreicht", () => {
    const pantry = [pantryItem({ name: "Hähnchenbrust", remainingQuantity: 500 }), pantryItem({ id: "p2", name: "Reis", remainingQuantity: 500 })];
    const insights = detectMealFullyCovered([meal()], pantry, now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("useful");
  });

  it("meldet NICHTS, wenn eine Zutat fehlt", () => {
    const pantry = [pantryItem({ name: "Hähnchenbrust", remainingQuantity: 500 })];
    const insights = detectMealFullyCovered([meal()], pantry, now);
    expect(insights).toHaveLength(0);
  });
});

describe("detectMealIngredientExpiresBeforeMeal", () => {
  it("erkennt, wenn die für eine künftige Mahlzeit benötigte Zutat vorher abläuft", () => {
    const inThreeDays = addDays(now, 3);
    const pantry = [pantryItem({ name: "Hähnchenbrust", expirationDate: addDays(now, 1) })];
    const insights = detectMealIngredientExpiresBeforeMeal([meal({ date: inThreeDays })], pantry, now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("important");
    expect(insights[0].message).toContain("Hähnchenbrust");
  });

  it("stuft einen Konflikt für morgen/übermorgen als critical ein", () => {
    const tomorrow = addDays(now, 1);
    const pantry = [pantryItem({ name: "Hähnchenbrust", expirationDate: now })];
    const insights = detectMealIngredientExpiresBeforeMeal([meal({ date: tomorrow })], pantry, now);
    expect(insights[0].priority).toBe("critical");
  });

  it("meldet NICHTS, wenn die Zutat erst nach der Mahlzeit abläuft", () => {
    const inThreeDays = addDays(now, 3);
    const pantry = [pantryItem({ name: "Hähnchenbrust", expirationDate: addDays(now, 5) })];
    const insights = detectMealIngredientExpiresBeforeMeal([meal({ date: inThreeDays })], pantry, now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für eine Mahlzeit in der Vergangenheit", () => {
    const pantry = [pantryItem({ name: "Hähnchenbrust", expirationDate: addDays(now, -1) })];
    const insights = detectMealIngredientExpiresBeforeMeal([meal({ date: addDays(now, -2) })], pantry, now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS, wenn kein Pantry-Item namentlich zur Zutat passt", () => {
    const pantry = [pantryItem({ name: "Tofu", expirationDate: addDays(now, 1) })];
    const insights = detectMealIngredientExpiresBeforeMeal([meal({ date: addDays(now, 3) })], pantry, now);
    expect(insights).toHaveLength(0);
  });
});
