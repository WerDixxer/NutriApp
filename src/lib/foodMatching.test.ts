import { describe, expect, it } from "vitest";
import { computeSingleItemScale, ingredientListIncludes, macroProfile, matchesAllergen } from "./foodMatching";

describe("matchesAllergen", () => {
  it("matches case-insensitively and on substrings", () => {
    expect(matchesAllergen(["Gluten", "Nüsse"], ["nüsse"])).toBe(true);
    expect(matchesAllergen(["gluten"], ["GLUTEN"])).toBe(true);
  });

  it("returns false when nothing overlaps", () => {
    expect(matchesAllergen(["milch"], ["nüsse", "soja"])).toBe(false);
  });

  it("returns false for an empty allergy list", () => {
    expect(matchesAllergen(["milch", "gluten"], [])).toBe(false);
  });
});

describe("ingredientListIncludes", () => {
  it("finds a term inside a longer ingredient line", () => {
    expect(ingredientListIncludes(["2 Salatgurken", "1 Zwiebel"], "gurke")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(ingredientListIncludes(["200g Hähnchenbrust"], "HÄHNCHEN")).toBe(true);
  });

  it("returns false when the term is absent", () => {
    expect(ingredientListIncludes(["Reis", "Brokkoli"], "tofu")).toBe(false);
  });
});

describe("macroProfile", () => {
  it("splits calories into protein/carbs/fat shares that sum to ~1", () => {
    const profile = macroProfile(500, 30, 50, 15); // 120 + 200 + 135 = 455 kcal of 500
    expect(profile.protein + profile.carbs + profile.fat).toBeCloseTo(455 / 500, 5);
  });

  it("does not divide by zero for a zero-kcal recipe", () => {
    const profile = macroProfile(0, 0, 0, 0);
    expect(Number.isFinite(profile.protein)).toBe(true);
  });
});

describe("computeSingleItemScale", () => {
  it("returns ~1 when the recipe already matches the target", () => {
    const target = { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 };
    expect(computeSingleItemScale(target, target)).toBeCloseTo(1, 1);
  });

  it("scales roughly 2x when the recipe is half the target across all macros", () => {
    const target = { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 };
    const half = { kcal: 250, proteinG: 15, carbsG: 25, fatG: 7.5 };
    expect(computeSingleItemScale(target, half)).toBeCloseTo(2, 1);
  });

  it("respects the given bounds", () => {
    const target = { kcal: 100, proteinG: 10, carbsG: 10, fatG: 5 };
    const tiny = { kcal: 5000, proteinG: 500, carbsG: 500, fatG: 250 };
    expect(computeSingleItemScale(target, tiny, [0.4, 2.5])).toBe(0.4);
  });
});
