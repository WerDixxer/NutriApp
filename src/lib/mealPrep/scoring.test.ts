import { describe, expect, it } from "vitest";
import { computeMealPrepScore, MEAL_PREP_WEIGHTS } from "./scoring";
import type { AggregatedIngredient, PrepGroup } from "./types";

function ingredient(overrides: Partial<AggregatedIngredient> = {}): AggregatedIngredient {
  return {
    key: "reis::G",
    normalizedName: "reis",
    displayName: "Reis",
    unit: "G",
    totalQuantity: 600,
    recipeCount: 2,
    sourceMeals: [],
    pantry: null,
    costCents: null,
    ...overrides,
  };
}

function group(overrides: Partial<PrepGroup> = {}): PrepGroup {
  return {
    id: "prep-1",
    name: "Batch",
    tasks: [{ ingredientKey: "reis", displayName: "Reis", totalQuantity: 600, unit: "G", usedForMeals: [], pantry: null }],
    sourceRecipeIds: ["r1", "r2"],
    earliestNeededDate: new Date("2026-09-21"),
    latestNeededDate: new Date("2026-09-22"),
    combinedPrepTimeMin: 40,
    ...overrides,
  };
}

const planStart = new Date("2026-09-21");
const planEnd = new Date("2026-09-27");

describe("computeMealPrepScore: weniger Kochvorgänge wird bevorzugt", () => {
  it("ein größerer Rückgang der Kochvorgänge ergibt einen höheren cookingSessions-Faktor", () => {
    const big = computeMealPrepScore([ingredient()], [group()], 5, 2, 5, planStart, planEnd);
    const small = computeMealPrepScore([ingredient()], [group()], 5, 4, 5, planStart, planEnd);
    const bigFactor = big.breakdown.find((f) => f.factor === "cookingSessions")!;
    const smallFactor = small.breakdown.find((f) => f.factor === "cookingSessions")!;
    expect(bigFactor.rawScore).toBeGreaterThan(smallFactor.rawScore);
  });

  it("keine Reduktion ergibt rawScore 0 für cookingSessions", () => {
    const result = computeMealPrepScore([ingredient()], [], 5, 5, 5, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "cookingSessions")!.rawScore).toBe(0);
  });
});

describe("computeMealPrepScore: Ingredient Reuse", () => {
  it("mehr wiederverwendete Zutaten ergeben einen höheren ingredientReuse-Score", () => {
    const allShared = [ingredient({ recipeCount: 2 }), ingredient({ key: "hähnchen", recipeCount: 3 })];
    const noneShared = [ingredient({ recipeCount: 1 }), ingredient({ key: "hähnchen", recipeCount: 1 })];
    const a = computeMealPrepScore(allShared, [group()], 5, 3, 5, planStart, planEnd);
    const b = computeMealPrepScore(noneShared, [], 5, 5, 5, planStart, planEnd);
    expect(a.breakdown.find((f) => f.factor === "ingredientReuse")!.rawScore).toBeGreaterThan(
      b.breakdown.find((f) => f.factor === "ingredientReuse")!.rawScore,
    );
  });
});

describe("computeMealPrepScore: Pantry Usage / Food Waste", () => {
  it("Pantry-Deckung erhöht pantryUsage", () => {
    const withPantry = [ingredient({ pantry: { availableQuantity: 300, urgency: null } })];
    const withoutPantry = [ingredient({ pantry: null })];
    const a = computeMealPrepScore(withPantry, [], 3, 3, 3, planStart, planEnd);
    const b = computeMealPrepScore(withoutPantry, [], 3, 3, 3, planStart, planEnd);
    expect(a.breakdown.find((f) => f.factor === "pantryUsage")!.rawScore).toBeGreaterThan(
      b.breakdown.find((f) => f.factor === "pantryUsage")!.rawScore,
    );
  });

  it("dringende Pantry-Items (CRITICAL/HIGH) erhöhen foodWaste", () => {
    const urgent = [ingredient({ pantry: { availableQuantity: 300, urgency: "CRITICAL" } })];
    const result = computeMealPrepScore(urgent, [], 3, 3, 3, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "foodWaste")!.rawScore).toBe(1);
  });

  it("foodWaste bleibt 0 ohne jede Pantry-Zuordnung", () => {
    const result = computeMealPrepScore([ingredient({ pantry: null })], [], 3, 3, 3, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "foodWaste")!.rawScore).toBe(0);
  });
});

describe("computeMealPrepScore: Variety", () => {
  it("eine einzelne, alles dominierende Zutat senkt den Variety-Score", () => {
    const dominant = [ingredient({ recipeCount: 5 })];
    const result = computeMealPrepScore(dominant, [], 5, 5, 5, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "variety")!.rawScore).toBeLessThan(0.2);
  });
});

describe("computeMealPrepScore: Budget nie erfunden", () => {
  it("bleibt neutral (0), wenn keine Zutat einen bekannten Preis hat", () => {
    const result = computeMealPrepScore([ingredient({ costCents: null })], [], 3, 3, 3, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "budget")!.rawScore).toBe(0);
  });

  it("ist positiv, wenn Preisdaten für Zutaten vorhanden sind", () => {
    const result = computeMealPrepScore([ingredient({ costCents: 150 })], [], 3, 3, 3, planStart, planEnd);
    expect(result.breakdown.find((f) => f.factor === "budget")!.rawScore).toBeGreaterThan(0);
  });
});

describe("computeMealPrepScore: Determinismus und Summe", () => {
  it("liefert bei gleicher Eingabe immer dasselbe Ergebnis", () => {
    const a = computeMealPrepScore([ingredient()], [group()], 5, 3, 5, planStart, planEnd);
    const b = computeMealPrepScore([ingredient()], [group()], 5, 3, 5, planStart, planEnd);
    expect(a).toEqual(b);
  });

  it("score entspricht der Summe aller weightedScore-Werte", () => {
    const result = computeMealPrepScore([ingredient()], [group()], 5, 3, 5, planStart, planEnd);
    const manualSum = result.breakdown.reduce((sum, f) => sum + f.weightedScore, 0);
    expect(result.score).toBeCloseTo(manualSum, 8);
  });

  it("enthält alle in MEAL_PREP_WEIGHTS definierten Faktoren", () => {
    const result = computeMealPrepScore([ingredient()], [group()], 5, 3, 5, planStart, planEnd);
    const names = result.breakdown.map((f) => f.factor);
    for (const key of Object.keys(MEAL_PREP_WEIGHTS)) expect(names).toContain(key);
  });
});
