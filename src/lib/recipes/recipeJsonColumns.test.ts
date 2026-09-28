import { describe, expect, it } from "vitest";
import { JsonColumnError } from "../validation/jsonColumn";
import { readRecipeDietTypes, readRecipeMealSlots, readRecipeStringList } from "./recipeJsonColumns";

const recipe = {
  id: "recipe-1",
  mealSlots: '["LUNCH","DINNER"]',
  dietTypes: '["OMNIVORE","VEGETARIAN"]',
  allergens: '["gluten"]',
  ingredients: '["100 g Reis","1 Ei"]',
  instructions: '["Kochen."]',
  tags: "[]",
};

describe("Recipe-JSON-Spalten", () => {
  it("liest gültige Spalten in der erwarteten Form", () => {
    expect(readRecipeMealSlots(recipe)).toEqual(["LUNCH", "DINNER"]);
    expect(readRecipeDietTypes(recipe)).toEqual(["OMNIVORE", "VEGETARIAN"]);
    expect(readRecipeStringList(recipe, "allergens")).toEqual(["gluten"]);
    expect(readRecipeStringList(recipe, "ingredients")).toEqual(["100 g Reis", "1 Ei"]);
    expect(readRecipeStringList(recipe, "tags")).toEqual([]);
  });

  it("wirft bei syntaktisch ungültigem JSON einen JsonColumnError mit Recipe-ID und Spalte", () => {
    expect(() => readRecipeStringList({ ...recipe, ingredients: "100 g Reis, 1 Ei" }, "ingredients")).toThrow(
      new JsonColumnError({ model: "Recipe", id: "recipe-1", column: "ingredients" }, { ok: false, reason: "invalid-json" }),
    );
  });

  it("wirft bei gültigem JSON mit falscher Struktur", () => {
    expect(() => readRecipeStringList({ ...recipe, instructions: '{"1":"Kochen."}' }, "instructions")).toThrow(JsonColumnError);
    expect(() => readRecipeMealSlots({ ...recipe, mealSlots: '"LUNCH"' })).toThrow(JsonColumnError);
  });

  it("wirft bei unbekannten Enum-Werten, statt sie als MealSlot/DietType durchzureichen", () => {
    expect(() => readRecipeMealSlots({ ...recipe, mealSlots: '["LUNCH","BRUNCH"]' })).toThrow(/Recipe recipe-1: Spalte "mealSlots"/);
    expect(() => readRecipeDietTypes({ ...recipe, dietTypes: '["vegan"]' })).toThrow(/Recipe recipe-1: Spalte "dietTypes"/);
  });

  it("wirft bei Listen mit inkompatiblen Elementen", () => {
    expect(() => readRecipeStringList({ ...recipe, allergens: '["gluten", null]' }, "allergens")).toThrow(JsonColumnError);
  });
});
