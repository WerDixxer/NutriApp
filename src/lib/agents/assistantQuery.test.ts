import { describe, expect, it } from "vitest";
import { assistantExtractionSchema, assistantQuerySchema } from "./assistantQuery";

describe("assistantExtractionSchema", () => {
  it("accepts a minimal valid extraction", () => {
    const result = assistantExtractionSchema.safeParse({ intent: "SEARCH_RECIPES", query: {} });
    expect(result.success).toBe(true);
  });

  it("accepts a fully populated query", () => {
    const result = assistantExtractionSchema.safeParse({
      intent: "SEARCH_RECIPES",
      query: {
        calories: 600,
        protein: 40,
        ingredients: ["Hähnchen", "Reis"],
        excludedIngredients: ["Milch"],
        allergies: ["Nüsse"],
        dietaryStyle: "omnivore",
        cuisine: "asiatisch",
        mealType: "Abendessen",
        servings: 2,
        maxCookingTimeMin: 20,
        budgetEur: 10,
        pantryOnly: true,
        mealPrep: false,
        preferences: ["schnell"],
        decisionMode: false,
        householdContext: "nur für mich",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown intent", () => {
    const result = assistantExtractionSchema.safeParse({ intent: "COOK_FOR_ME", query: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a negative calorie value", () => {
    const result = assistantQuerySchema.safeParse({ calories: -100 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing query object", () => {
    const result = assistantExtractionSchema.safeParse({ intent: "OTHER" });
    expect(result.success).toBe(false);
  });

  it("ignores unrelated extra fields gracefully by stripping them", () => {
    // Standard zod-Objekte ignorieren unbekannte Felder (kein .strict()), das
    // ist hier bewusst so, damit ein LLM auch mal ein zusätzliches Feld
    // liefern kann, ohne die ganze Extraktion zu verwerfen.
    const result = assistantQuerySchema.safeParse({ calories: 500, somethingUnexpected: true });
    expect(result.success).toBe(true);
  });
});
