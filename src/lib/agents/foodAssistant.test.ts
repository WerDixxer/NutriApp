import { describe, expect, it } from "vitest";
import { toNutritionQuery } from "./foodAssistant";

describe("toNutritionQuery", () => {
  it("maps the fields recipeSearch actually understands", () => {
    const nq = toNutritionQuery({
      calories: 600,
      protein: 40,
      carbs: 50,
      fat: 15,
      ingredients: ["Hähnchen", "Reis"],
      excludedIngredients: ["Milch"],
      dietaryStyle: "vegetarisch",
      cuisine: "italienisch",
      preferences: ["schnell"],
      allergies: ["Nüsse"],
      maxCookingTimeMin: 20,
      mealType: "Abendessen",
    });

    expect(nq.calorieTarget).toBe(600);
    expect(nq.proteinTarget).toBe(40);
    expect(nq.carbTarget).toBe(50);
    expect(nq.fatTarget).toBe(15);
    expect(nq.availableIngredients).toEqual(["Hähnchen", "Reis"]);
    expect(nq.excludedIngredients).toEqual(["Milch"]);
    expect(nq.allergies).toEqual(["Nüsse"]);
    expect(nq.maxPreparationTimeMin).toBe(20);
    expect(nq.mealType).toBe("Abendessen");
    // dietaryStyle + preferences + cuisine fließen zusammen als weiche Präferenzen ein.
    expect(nq.dietaryPreferences).toEqual(["vegetarisch", "schnell", "italienisch"]);
  });

  it("merges extra overrides (e.g. profile allergies) on top of the query", () => {
    const nq = toNutritionQuery({ allergies: ["Nüsse"] }, { allergies: ["Nüsse", "Laktose"] });
    expect(nq.allergies).toEqual(["Nüsse", "Laktose"]);
  });

  it("produces an empty dietaryPreferences array when nothing was extracted", () => {
    const nq = toNutritionQuery({});
    expect(nq.dietaryPreferences).toEqual([]);
  });
});
