import { describe, expect, it } from "vitest";
import type { SearchableRecipe } from "../recipeSearch";
import type { HardConstraintContext } from "./hardConstraints";
import type { ScoringContext } from "./softScoring";
import { selectBestCandidate } from "./selectBestCandidate";

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

const hardCtx: HardConstraintContext = { allergies: [], dietType: "OMNIVORE", excludedIngredients: [] };
const scoringCtx: ScoringContext = {
  targetKcal: 500,
  targetProteinG: 30,
  targetCarbsG: 50,
  targetFatG: 15,
  likedFoods: [],
  dislikedFoods: [],
  preferences: [],
  recentRecipeCounts: new Map(),
};

describe("selectBestCandidate", () => {
  it("wählt bei mehreren gültigen Kandidaten deterministisch denselben (nächste Mahlzeit am Ziel gewinnt)", () => {
    const candidates = [
      recipe({ id: "close", kcal: 510, proteinG: 31 }),
      recipe({ id: "far", kcal: 1200, proteinG: 5 }),
      recipe({ id: "mid", kcal: 700, proteinG: 20 }),
    ];

    const result1 = selectBestCandidate(candidates, hardCtx, scoringCtx);
    const result2 = selectBestCandidate(candidates, hardCtx, scoringCtx);

    expect(result1?.winner.id).toBe("close");
    expect(result1?.winner.id).toBe(result2?.winner.id);
  });

  it("bricht einen exakten Score-Gleichstand deterministisch über die Recipe-ID", () => {
    const candidates = [recipe({ id: "b" }), recipe({ id: "a" }), recipe({ id: "c" })];
    const result = selectBestCandidate(candidates, hardCtx, scoringCtx);
    expect(result?.winner.id).toBe("a");
  });

  it("eliminiert einen Kandidaten mit Allergie vollständig, unabhängig von einem sonst perfekten Score", () => {
    const candidates = [
      recipe({ id: "allergic", kcal: 500, proteinG: 30, allergens: ["Nüsse"] }), // perfekter Kalorien-/Makrotreffer, aber Allergen
      recipe({ id: "safe", kcal: 900, proteinG: 5 }), // schlechter Score, aber sicher
    ];
    const result = selectBestCandidate(candidates, { ...hardCtx, allergies: ["Nüsse"] }, scoringCtx);
    expect(result?.winner.id).toBe("safe");
  });

  it("gibt bei keinem gültigen Kandidaten einen sauberen Fallback (null) zurück, nie einen erfundenen Treffer", () => {
    const candidates = [recipe({ id: "r1", dietTypes: ["VEGAN"] })];
    const result = selectBestCandidate(candidates, { ...hardCtx, dietType: "OMNIVORE" }, scoringCtx);
    expect(result).toBeNull();
  });

  it("gibt bei einer leeren Kandidatenliste ebenfalls einen sauberen Fallback zurück", () => {
    expect(selectBestCandidate([], hardCtx, scoringCtx)).toBeNull();
  });

  it("listet ausgeschlossene Kandidaten mit nachvollziehbarem Grund in rejectedCandidates", () => {
    const candidates = [recipe({ id: "good" }), recipe({ id: "bad", dietTypes: ["VEGAN"] })];
    const result = selectBestCandidate(candidates, hardCtx, scoringCtx);
    expect(result?.rejectedCandidates).toHaveLength(1);
    expect(result?.rejectedCandidates[0].recipeId).toBe("bad");
    expect(result?.rejectedCandidates[0].reason).toMatch(/Ernährungsform/);
  });

  it("Explainability: reasons enthalten nur Gründe von Faktoren, die beim Gewinner tatsächlich zutrafen", () => {
    const candidates = [recipe({ id: "winner", kcal: 500, proteinG: 30 })];
    const result = selectBestCandidate(candidates, hardCtx, scoringCtx);
    expect(result?.reasons).toContain("Passt gut zu deinem Kalorienziel.");
    expect(result?.reasons).toContain("Enthält ausreichend Protein für dein Ziel.");
    // Keine Pantry-/Präferenz-Begründung, da weder availableIngredients noch preferences/likedFoods gesetzt sind.
    expect(result?.reasons.some((r) => r.includes("bereits hast"))).toBe(false);
    expect(result?.reasons.some((r) => r.includes("Präferenzen"))).toBe(false);
  });

  it("Explainability: constraintsApplied spiegelt genau die tatsächlich geprüften Hard Constraints wider", () => {
    const candidates = [recipe()];
    const result = selectBestCandidate(candidates, { ...hardCtx, allergies: ["Nüsse"], excludedIngredients: ["Milch"] }, scoringCtx);
    expect(result?.constraintsApplied).toEqual(["dietaryStyle", "allergies", "excludedIngredients"]);
  });
});
