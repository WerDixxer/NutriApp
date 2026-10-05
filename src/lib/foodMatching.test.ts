import { describe, expect, it } from "vitest";
import type { DietType } from "@prisma/client";
import { checkHardConstraints } from "./agents/decision/hardConstraints";
import type { SearchableRecipe } from "./agents/recipeSearch";
import {
  PORTION_SCALE_BOUNDS,
  computeSingleItemScale,
  fitsProfileHardRules,
  ingredientListIncludes,
  macroProfile,
  matchesAllergen,
} from "./foodMatching";
import type { FoodCatalog } from "./recipes/catalog";

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

describe("fitsProfileHardRules (R5F-9)", () => {
  const omnivore = { dietType: "OMNIVORE" as const, allergies: [] };

  it("schließt ein Rezept aus, das nicht zur Ernährungsform passt", () => {
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE"], allergens: [], ingredients: ["100 g Reis"] }, { dietType: "VEGAN", allergies: [] })).toBe(false);
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE", "VEGAN"], allergens: [], ingredients: ["100 g Reis"] }, { dietType: "VEGAN", allergies: [] })).toBe(true);
  });

  it("schließt ein Rezept mit einer Allergie des Profils aus - über die Allergen-Angabe oder die Zutaten", () => {
    const peanutAllergy = { dietType: "OMNIVORE" as const, allergies: ["Erdnüsse"] };
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE"], allergens: ["erdnuss"], ingredients: ["100 g Reis"] }, peanutAllergy)).toBe(false);
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE"], allergens: [], ingredients: ["50 g Erdnüsse"] }, peanutAllergy)).toBe(false);
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE"], allergens: ["gluten"], ingredients: ["100 g Reis"] }, peanutAllergy)).toBe(true);
  });

  it("ohne Allergien bleibt ein Rezept mit Allergenen zulässig", () => {
    expect(fitsProfileHardRules({ dietTypes: ["OMNIVORE"], allergens: ["erdnuss", "milch"], ingredients: ["50 g Erdnüsse"] }, omnivore)).toBe(true);
  });

  it("prüft Allergene nur für Rezepte mit passender Ernährungsform (Kurzschluss wie bisher)", () => {
    const untouchableCatalog = new Proxy({} as FoodCatalog, {
      get() {
        throw new Error("Der Katalog darf für ein unpassendes Rezept nicht gelesen werden.");
      },
    });
    const milkAllergy = { dietType: "VEGAN" as const, allergies: ["Milch"] };
    const recipe = { dietTypes: ["OMNIVORE"] as DietType[], allergens: [], ingredients: ["300 g Skyr"] };
    expect(fitsProfileHardRules(recipe, milkAllergy, untouchableCatalog)).toBe(false);
    // Gegenprobe: mit passender Ernährungsform läuft die Allergen-Prüfung samt Katalog.
    expect(() => fitsProfileHardRules({ ...recipe, dietTypes: ["VEGAN"] }, milkAllergy, untouchableCatalog)).toThrow();
  });

  it("Abneigungen und ausgeschlossene Zutaten gehören nicht dazu; checkHardConstraints prüft Ausschlüsse weiterhin separat", () => {
    const mushrooms = searchable({ ingredients: ["200 g Pilze"] });
    expect(fitsProfileHardRules(mushrooms, omnivore)).toBe(true);
    expect(checkHardConstraints(mushrooms, { ...omnivore, excludedIngredients: ["Pilze"] }).map((v) => v.constraint)).toEqual(["excludedIngredients"]);
  });

  it("entscheidet genau wie checkHardConstraints ohne ausgeschlossene Zutaten", () => {
    const dietTypeOptions: DietType[][] = [["OMNIVORE"], ["VEGAN"], ["VEGETARIAN", "VEGAN"]];
    const allergenOptions = [[], ["milch"], ["erdnuss"]];
    const ingredientOptions = [["100 g Reis"], ["50 g Erdnussbutter"], ["200 ml Milch"]];
    const profiles: { dietType: DietType; allergies: string[] }[] = [
      { dietType: "OMNIVORE", allergies: [] },
      { dietType: "VEGAN", allergies: [] },
      { dietType: "OMNIVORE", allergies: ["Milch"] },
      { dietType: "VEGAN", allergies: ["Erdnüsse", "Gluten"] },
    ];
    let checked = 0;
    for (const dietTypes of dietTypeOptions) {
      for (const allergens of allergenOptions) {
        for (const ingredients of ingredientOptions) {
          const recipe = searchable({ dietTypes, allergens, ingredients });
          for (const profile of profiles) {
            const central = checkHardConstraints(recipe, { ...profile, excludedIngredients: [] }).length === 0;
            expect(fitsProfileHardRules(recipe, profile), JSON.stringify({ dietTypes, allergens, ingredients, profile })).toBe(central);
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(108);
  });
});

describe("PORTION_SCALE_BOUNDS (R5F-9)", () => {
  it("ist die gemeinsame Grenze 0,4x bis 2,5x", () => {
    expect(PORTION_SCALE_BOUNDS).toEqual({ min: 0.4, max: 2.5 });
  });

  it("computeSingleItemScale nutzt sie ohne ausdrückliche Grenzen", () => {
    const target = { kcal: 600, proteinG: 40, carbsG: 60, fatG: 20 };
    expect(computeSingleItemScale(target, { kcal: 20, proteinG: 1, carbsG: 2, fatG: 0.5 })).toBe(2.5);
    expect(computeSingleItemScale(target, { kcal: 6000, proteinG: 400, carbsG: 600, fatG: 200 })).toBe(0.4);
  });
});

function searchable(overrides: Partial<SearchableRecipe>): SearchableRecipe {
  return {
    id: "r1",
    name: "Testrezept",
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
    ingredients: ["100 g Reis"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}
