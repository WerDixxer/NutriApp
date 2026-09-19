import { describe, expect, it } from "vitest";
import { buildPrepGroups, buildSoloRecipes, type RecipeInfo } from "./batching";
import type { AggregatedIngredient, SourceMealRef } from "./types";

function sourceMeal(overrides: Partial<SourceMealRef>): SourceMealRef {
  return {
    mealId: "m1",
    date: new Date("2026-09-21"),
    slot: "LUNCH",
    recipeId: "r1",
    recipeName: "Rezept 1",
    quantityForMeal: 200,
    ...overrides,
  };
}

function ingredient(overrides: Partial<AggregatedIngredient> = {}): AggregatedIngredient {
  return {
    key: "reis::G",
    normalizedName: "reis",
    displayName: "Reis",
    unit: "G",
    totalQuantity: 600,
    recipeCount: 2,
    sourceMeals: [sourceMeal({ recipeId: "r1" }), sourceMeal({ recipeId: "r2" })],
    pantry: null,
    costCents: null,
    ...overrides,
  };
}

describe("buildPrepGroups: 2 Rezepte teilen sich eine Zutat", () => {
  it("bildet eine Batch Opportunity, wenn 2 Rezepte dieselbe Zutat brauchen", () => {
    const { prepGroups } = buildPrepGroups([ingredient()], "BALANCED");
    expect(prepGroups).toHaveLength(1);
    expect(prepGroups[0].tasks[0].totalQuantity).toBe(600);
  });

  it("liefert keine Prep-Gruppen ohne batchbare Zutaten", () => {
    expect(buildPrepGroups([], "BALANCED").prepGroups).toEqual([]);
  });
});

describe("buildPrepGroups: 5 Rezepte teilen sich eine Zutat", () => {
  it("fasst alle 5 in derselben Gruppe zusammen (MIN_COOKING)", () => {
    const wideIngredient = ingredient({
      recipeCount: 5,
      sourceMeals: ["r1", "r2", "r3", "r4", "r5"].map((r) => sourceMeal({ recipeId: r })),
    });
    const { prepGroups } = buildPrepGroups([wideIngredient], "MIN_COOKING");
    expect(prepGroups).toHaveLength(1);
    expect(prepGroups[0].sourceRecipeIds).toHaveLength(5);
  });
});

describe("buildPrepGroups: Strategien unterscheiden sich real", () => {
  const chicken = ingredient({ key: "hähnchen::G", normalizedName: "hähnchen", displayName: "Hähnchen", recipeCount: 2, sourceMeals: [sourceMeal({ recipeId: "r1" }), sourceMeal({ recipeId: "r2" })] });
  const sauce = ingredient({
    key: "sauce::G",
    normalizedName: "sauce",
    displayName: "Sauce",
    recipeCount: 2,
    sourceMeals: [sourceMeal({ recipeId: "r3", date: new Date("2026-09-25") }), sourceMeal({ recipeId: "r4", date: new Date("2026-09-26") })],
  });

  it("MIN_COOKING bündelt auch unabhängige Zutaten (r1/r2 und r3/r4 teilen kein Rezept) in einer Sitzung", () => {
    const { prepGroups } = buildPrepGroups([chicken, sauce], "MIN_COOKING");
    expect(prepGroups).toHaveLength(1);
  });

  it("BALANCED trennt Zutaten ohne gemeinsames Rezept in eigene Cluster (Connected Components)", () => {
    const { prepGroups } = buildPrepGroups([chicken, sauce], "BALANCED");
    expect(prepGroups).toHaveLength(2);
  });

  it("BALANCED bündelt Zutaten, die dasselbe Rezept teilen, in einem Cluster", () => {
    const rice = ingredient({ key: "reis2::G", normalizedName: "reis2", displayName: "Reis", recipeCount: 2, sourceMeals: [sourceMeal({ recipeId: "r1" }), sourceMeal({ recipeId: "r5" })] });
    const { prepGroups } = buildPrepGroups([chicken, rice], "BALANCED");
    // chicken (r1,r2) und rice (r1,r5) teilen r1 -> ein gemeinsamer Cluster
    expect(prepGroups).toHaveLength(1);
    expect(prepGroups[0].tasks).toHaveLength(2);
  });

  it("FRESHNESS splittet nach frühestem Bedarfsdatum in mehrere Sitzungen", () => {
    const { prepGroups } = buildPrepGroups([chicken, sauce], "FRESHNESS");
    expect(prepGroups.length).toBeGreaterThanOrEqual(2);
  });
});

describe("buildPrepGroups: keine Wiederverwendung", () => {
  it("eine Zutat, die nur von einem Rezept gebraucht wird, würde ohnehin nicht als batchbar übergeben - buildPrepGroups selbst prüft recipeCount nicht erneut", () => {
    // buildPrepGroups erhält bereits gefilterte batchbare Zutaten (siehe mealPrepService.ts); mit einer leeren Liste passiert nichts.
    expect(buildPrepGroups([], "BALANCED").prepGroups).toEqual([]);
  });
});

describe("buildSoloRecipes", () => {
  it("Rezepte, die kein gemeinsames Batching haben, bleiben eigenständig", () => {
    const recipes: RecipeInfo[] = [
      { recipeId: "r1", recipeName: "Rezept 1", meals: [{ mealId: "m1", date: new Date(), slot: "LUNCH" }] },
      { recipeId: "r9", recipeName: "Solo-Rezept", meals: [{ mealId: "m9", date: new Date(), slot: "DINNER" }] },
    ];
    const { prepGroups } = buildPrepGroups([ingredient({ sourceMeals: [sourceMeal({ recipeId: "r1" }), sourceMeal({ recipeId: "r2" })] })], "BALANCED");
    const solo = buildSoloRecipes(recipes, prepGroups);
    expect(solo.map((r) => r.recipeId)).toEqual(["r9"]);
  });

  it("gibt eine leere Liste zurück, wenn alle Rezepte gebatched sind", () => {
    const recipes: RecipeInfo[] = [
      { recipeId: "r1", recipeName: "Rezept 1", meals: [{ mealId: "m1", date: new Date(), slot: "LUNCH" }] },
      { recipeId: "r2", recipeName: "Rezept 2", meals: [{ mealId: "m2", date: new Date(), slot: "DINNER" }] },
    ];
    const { prepGroups } = buildPrepGroups([ingredient()], "BALANCED");
    expect(buildSoloRecipes(recipes, prepGroups)).toEqual([]);
  });
});
