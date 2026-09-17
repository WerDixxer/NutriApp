import { describe, expect, it } from "vitest";
import type { SearchableRecipe } from "../recipeSearch";
import { hasValidCoreNutrition } from "./candidateValidation";

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    id: "r1",
    name: "Testgericht",
    description: "",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: ["LUNCH"],
    dietTypes: ["OMNIVORE"],
    allergens: [],
    ingredients: [],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

describe("hasValidCoreNutrition", () => {
  it("akzeptiert ein Rezept mit vollständigen, gültigen Kernwerten", () => {
    expect(hasValidCoreNutrition(recipe())).toBe(true);
  });

  it("lehnt NaN als Kernwert ab, statt ihn als 0 zu behandeln", () => {
    expect(hasValidCoreNutrition(recipe({ kcal: NaN }))).toBe(false);
  });

  it("lehnt negative Kernwerte ab", () => {
    expect(hasValidCoreNutrition(recipe({ proteinG: -5 }))).toBe(false);
  });

  it("lehnt Infinity als Kernwert ab", () => {
    expect(hasValidCoreNutrition(recipe({ fatG: Infinity }))).toBe(false);
  });
});
