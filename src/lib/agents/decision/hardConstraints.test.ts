import { describe, expect, it } from "vitest";
import type { SearchableRecipe } from "../recipeSearch";
import { buildConstraintsAppliedList, checkHardConstraints, type HardConstraintContext } from "./hardConstraints";

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    id: "r1",
    name: "Testgericht",
    description: "Ein Testgericht.",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: ["LUNCH"],
    dietTypes: ["OMNIVORE"],
    allergens: [],
    ingredients: ["200 g Reis", "150 g Hähnchen"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

const baseCtx: HardConstraintContext = { allergies: [], dietType: "OMNIVORE", excludedIngredients: [] };

describe("checkHardConstraints", () => {
  it("schließt einen Kandidaten mit einer bekannten Allergie aus", () => {
    const violations = checkHardConstraints(recipe({ allergens: ["Nüsse"] }), { ...baseCtx, allergies: ["Nüsse"] });
    expect(violations.some((v) => v.constraint === "allergies")).toBe(true);
  });

  it("lässt einen Kandidaten ohne Allergen-Überschneidung durch", () => {
    const violations = checkHardConstraints(recipe({ allergens: ["gluten"] }), { ...baseCtx, allergies: ["Nüsse"] });
    expect(violations.some((v) => v.constraint === "allergies")).toBe(false);
  });

  it("schließt einen Kandidaten aus, der nicht zur Ernährungsform passt", () => {
    const violations = checkHardConstraints(recipe({ dietTypes: ["VEGAN"] }), { ...baseCtx, dietType: "OMNIVORE" });
    expect(violations.some((v) => v.constraint === "dietaryStyle")).toBe(true);
  });

  it("lässt einen Kandidaten durch, der zur Ernährungsform passt", () => {
    const violations = checkHardConstraints(recipe({ dietTypes: ["OMNIVORE", "HALAL"] }), {
      ...baseCtx,
      dietType: "OMNIVORE",
    });
    expect(violations.some((v) => v.constraint === "dietaryStyle")).toBe(false);
  });

  it("schließt einen Kandidaten mit einer explizit ausgeschlossenen Zutat aus", () => {
    const violations = checkHardConstraints(recipe({ ingredients: ["200 ml Milch", "50 g Haferflocken"] }), {
      ...baseCtx,
      excludedIngredients: ["Milch"],
    });
    expect(violations.some((v) => v.constraint === "excludedIngredients")).toBe(true);
  });

  it("lässt einen Kandidaten ohne ausgeschlossene Zutaten durch", () => {
    const violations = checkHardConstraints(recipe({ ingredients: ["200 g Reis"] }), {
      ...baseCtx,
      excludedIngredients: ["Milch"],
    });
    expect(violations).toHaveLength(0);
  });

  it("sammelt mehrere gleichzeitige Verstöße statt nur den ersten", () => {
    const violations = checkHardConstraints(
      recipe({ allergens: ["Nüsse"], dietTypes: ["VEGAN"], ingredients: ["Milch"] }),
      { allergies: ["Nüsse"], dietType: "OMNIVORE", excludedIngredients: ["Milch"] },
    );
    expect(violations).toHaveLength(3);
  });
});

describe("buildConstraintsAppliedList", () => {
  it("führt dietaryStyle immer auf", () => {
    expect(buildConstraintsAppliedList(baseCtx)).toEqual(["dietaryStyle"]);
  });

  it("führt allergies nur auf, wenn Allergien bekannt sind", () => {
    expect(buildConstraintsAppliedList({ ...baseCtx, allergies: ["Nüsse"] })).toContain("allergies");
  });

  it("führt excludedIngredients nur auf, wenn welche genannt wurden", () => {
    expect(buildConstraintsAppliedList({ ...baseCtx, excludedIngredients: ["Milch"] })).toContain(
      "excludedIngredients",
    );
  });
});
