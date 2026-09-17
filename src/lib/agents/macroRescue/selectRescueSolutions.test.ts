import { describe, expect, it } from "vitest";
import type { SearchableRecipe } from "../recipeSearch";
import type { HardConstraintContext } from "../decision/hardConstraints";
import { DEFAULT_MACRO_LOSS_WEIGHTS } from "./lossWeights";
import { DEFAULT_MACRO_TOLERANCES } from "./tolerances";
import { selectRescueSolutions } from "./selectRescueSolutions";
import type { MacroRescueTargets } from "./types";

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

const hardCtx: HardConstraintContext = { allergies: [], dietType: "OMNIVORE", excludedIngredients: [] };
const targets: MacroRescueTargets = { calories: 650, protein: 55, carbs: 60, fat: 18 };

describe("selectRescueSolutions", () => {
  it("findet einen exakten Treffer und meldet totalLoss 0", () => {
    const candidates = [recipe({ id: "exact", kcal: 650, proteinG: 55, carbsG: 60, fatG: 18 })];
    const { solutions } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(solutions[0].totalLoss).toBe(0);
  });

  it("liefert bei keinem exakten Treffer die beste verfügbare Annäherung, nicht die schlechteste", () => {
    const candidates = [
      recipe({ id: "close", kcal: 700, proteinG: 50, carbsG: 65, fatG: 20 }),
      recipe({ id: "far", kcal: 1500, proteinG: 10, carbsG: 200, fatG: 80 }),
    ];
    const { solutions } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(solutions[0].recipeId).toBe("close");
  });

  it("eliminiert einen Kandidaten mit bekannter Allergie vollständig", () => {
    const candidates = [
      recipe({ id: "allergic", kcal: 650, proteinG: 55, carbsG: 60, fatG: 18, allergens: ["Nüsse"] }),
      recipe({ id: "safe", kcal: 900, proteinG: 20, carbsG: 80, fatG: 30 }),
    ];
    const { solutions, rejectedCandidates } = selectRescueSolutions(
      candidates,
      { ...hardCtx, allergies: ["Nüsse"] },
      targets,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
      3,
    );
    expect(solutions.every((s) => s.recipeId !== "allergic")).toBe(true);
    expect(rejectedCandidates.some((r) => r.recipeId === "allergic")).toBe(true);
  });

  it("eliminiert einen Kandidaten, der nicht zur Ernährungsform passt", () => {
    const candidates = [recipe({ id: "vegan-only", dietTypes: ["VEGAN"] })];
    const { solutions, rejectedCandidates } = selectRescueSolutions(
      candidates,
      { ...hardCtx, dietType: "OMNIVORE" },
      targets,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
      3,
    );
    expect(solutions).toHaveLength(0);
    expect(rejectedCandidates[0].reason).toMatch(/Ernährungsform/);
  });

  it("schließt einen Kandidaten mit ungültigen Nährwerten aus, statt ihn mit 0 zu bewerten", () => {
    const candidates = [recipe({ id: "broken", kcal: NaN })];
    const { solutions, rejectedCandidates } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(solutions).toHaveLength(0);
    expect(rejectedCandidates[0].reason).toMatch(/Nährwertdaten/);
  });

  it("gibt bei leerem Kandidatenpool eine leere Lösungsliste zurück, keinen Fehler", () => {
    const { solutions, rejectedCandidates } = selectRescueSolutions([], hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(solutions).toEqual([]);
    expect(rejectedCandidates).toEqual([]);
  });

  it("liefert bei gleichem Input ein deterministisches Ergebnis", () => {
    const candidates = [
      recipe({ id: "a", kcal: 700 }),
      recipe({ id: "b", kcal: 600 }),
      recipe({ id: "c", kcal: 690 }),
    ];
    const run1 = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    const run2 = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(run1.solutions.map((s) => s.recipeId)).toEqual(run2.solutions.map((s) => s.recipeId));
  });

  it("bricht einen exakten Loss-Gleichstand deterministisch über die Recipe-ID", () => {
    const candidates = [recipe({ id: "b" }), recipe({ id: "a" }), recipe({ id: "c" })];
    const { solutions } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    expect(solutions[0].recipeId).toBe("a");
  });

  it("Explainability: deviations im Ergebnis stimmen mit den tatsächlichen actual-Werten überein", () => {
    const candidates = [recipe({ id: "r1", kcal: 500, proteinG: 40, carbsG: 50, fatG: 15 })];
    const { solutions } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 3);
    const solution = solutions[0];
    const caloriesDeviation = solution.deviations.find((d) => d.macro === "calories")!;
    expect(caloriesDeviation.actual).toBe(solution.actual.calories);
    expect(solution.explanation).toContain(String(Math.round(solution.actual.calories)));
  });

  it("begrenzt die Ergebnisliste auf das übergebene Limit", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => recipe({ id: `r${i}`, kcal: 600 + i * 10 }));
    const { solutions } = selectRescueSolutions(candidates, hardCtx, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, 2);
    expect(solutions).toHaveLength(2);
  });
});
