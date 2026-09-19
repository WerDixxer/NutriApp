import { describe, expect, it } from "vitest";
import {
  MEAL_PLAN_WEIGHTS,
  mainIngredientToken,
  scoreBudget,
  scoreCalories,
  scoreCandidate,
  scoreCarbs,
  scoreFat,
  scoreFiber,
  scoreFoodWaste,
  scoreIngredientReuse,
  scorePantry,
  scorePreferences,
  scorePrepTime,
  scoreProtein,
  scoreVariety,
  type MealSlotScoringContext,
} from "./softScoring";
import type { SearchableRecipe } from "../agents/recipeSearch";

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    id: "recipe-1",
    name: "Hähnchen-Bowl",
    description: "",
    kcal: 600,
    proteinG: 45,
    carbsG: 60,
    fatG: 18,
    prepTimeMin: 25,
    servings: 1,
    mealSlots: ["LUNCH"],
    dietTypes: ["OMNIVORE"],
    allergens: [],
    ingredients: ["200g Hähnchenbrust", "150g Reis", "1 Brokkoli"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<MealSlotScoringContext> = {}): MealSlotScoringContext {
  return {
    slotTarget: { slot: "LUNCH", kcal: 600, proteinG: 45, carbsG: 60, fatG: 18 },
    likedFoods: [],
    dislikedFoods: [],
    availablePantryIngredientNames: [],
    urgentPantryIngredientNames: [],
    remainingBudgetCents: null,
    recentRecipeCount: 0,
    usedIngredientsInPlan: new Set(),
    recentMainIngredients: [],
    ...overrides,
  };
}

describe("scoreCalories", () => {
  it("bewertet einen exakten Treffer mit rawScore nahe 1", () => {
    const result = scoreCalories(recipe(), ctx());
    expect(result.rawScore).toBeCloseTo(1, 5);
  });

  it("bewertet eine große Abweichung niedriger", () => {
    const result = scoreCalories(recipe({ kcal: 1500 }), ctx());
    expect(result.rawScore).toBeLessThan(0.5);
  });
});

describe("scoreProtein/scoreCarbs/scoreFat: Makro-ZUSAMMENSETZUNG statt absoluter Wert", () => {
  it("ein doppelt so großes Rezept mit gleicher Zusammensetzung bekommt trotzdem einen hohen Protein-Score", () => {
    const doubled = recipe({ kcal: 1200, proteinG: 90, carbsG: 120, fatG: 36 });
    const result = scoreProtein(doubled, ctx());
    expect(result.rawScore).toBeGreaterThan(0.95);
  });

  it("ein proteinarmes Rezept bekommt einen niedrigeren Protein-Score als ein proteinreiches bei gleichem Ziel", () => {
    const proteinRich = scoreProtein(recipe({ proteinG: 45 }), ctx());
    const proteinPoor = scoreProtein(recipe({ proteinG: 5, carbsG: 100 }), ctx());
    expect(proteinRich.rawScore).toBeGreaterThan(proteinPoor.rawScore);
  });

  it("scoreCarbs bewertet eine abweichende Carb-Zusammensetzung niedriger", () => {
    const matching = scoreCarbs(recipe(), ctx());
    const mismatched = scoreCarbs(recipe({ carbsG: 5, proteinG: 90 }), ctx());
    expect(matching.rawScore).toBeGreaterThan(mismatched.rawScore);
  });

  it("scoreFat bewertet eine abweichende Fett-Zusammensetzung niedriger", () => {
    const matching = scoreFat(recipe(), ctx());
    const mismatched = scoreFat(recipe({ fatG: 80, carbsG: 10 }), ctx());
    expect(matching.rawScore).toBeGreaterThan(mismatched.rawScore);
  });
});

describe("scoreFiber", () => {
  it("ist immer neutral (0), da Recipe kein Ballaststoff-Feld hat - reine Wiederverwendung des Decision-Engine-Stubs", () => {
    const result = scoreFiber();
    expect(result.rawScore).toBe(0);
    expect(result.weightedScore).toBe(0);
  });
});

describe("scorePantry", () => {
  it("neutral (0), wenn keine Pantry-Daten vorhanden sind", () => {
    const result = scorePantry(recipe(), ctx());
    expect(result.rawScore).toBe(0);
  });

  it("positiv, wenn eine Pantry-Zutat im Rezept vorkommt", () => {
    const result = scorePantry(recipe(), ctx({ availablePantryIngredientNames: ["Hähnchenbrust"] }));
    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.reason).toContain("Hähnchenbrust");
  });
});

describe("scoreFoodWaste", () => {
  it("neutral (0) ohne dringende Pantry-Items", () => {
    const result = scoreFoodWaste(recipe(), ctx());
    expect(result.rawScore).toBe(0);
  });

  it("voller Bonus, wenn ein dringendes Pantry-Item verwertet wird", () => {
    const result = scoreFoodWaste(recipe(), ctx({ urgentPantryIngredientNames: ["Brokkoli"] }));
    expect(result.rawScore).toBe(1);
    expect(result.reason).toMatch(/ablaufende/);
  });
});

describe("scoreBudget: nie ein erfundener Preis", () => {
  it("ist neutral (0), wenn kein Budget gesetzt ist", () => {
    expect(scoreBudget().rawScore).toBe(0);
  });

  it("bleibt neutral, auch konzeptionell unabhängig vom Budget-Kontext (kein Preismodell pro Rezept)", () => {
    // scoreBudget() nimmt bewusst keinen Kontext entgegen: es gibt aktuell nirgends echte Preisdaten pro Rezept.
    expect(scoreBudget().weightedScore).toBe(0);
  });
});

describe("scorePrepTime", () => {
  it("bewertet ein schnelles Rezept höher als ein langsames", () => {
    const fast = scorePrepTime(recipe({ prepTimeMin: 10 }), 40);
    const slow = scorePrepTime(recipe({ prepTimeMin: 90 }), 40);
    expect(fast.rawScore).toBeGreaterThan(slow.rawScore);
  });
});

describe("scorePreferences", () => {
  it("positiv bei einer gemochten Zutat", () => {
    const result = scorePreferences(recipe(), ctx({ likedFoods: ["Hähnchen"] }));
    expect(result.rawScore).toBeGreaterThan(0);
  });

  it("negativ bei einer nicht gemochten Zutat", () => {
    const result = scorePreferences(recipe(), ctx({ dislikedFoods: ["Brokkoli"] }));
    expect(result.rawScore).toBeLessThan(0);
  });
});

describe("scoreVariety", () => {
  it("volle Punktzahl ohne jede kürzliche Wiederholung", () => {
    expect(scoreVariety(recipe(), ctx()).rawScore).toBe(1);
  });

  it("bestraft ein kürzlich wiederholtes Rezept", () => {
    const result = scoreVariety(recipe(), ctx({ recentRecipeCount: 2 }));
    expect(result.rawScore).toBeLessThan(1);
  });

  it("bestraft zusätzlich eine wiederholte Hauptzutat", () => {
    const withoutRepeat = scoreVariety(recipe(), ctx({ recentMainIngredients: ["reis"] }));
    const withRepeat = scoreVariety(recipe(), ctx({ recentMainIngredients: ["hähnchenbrust"] }));
    expect(withRepeat.rawScore).toBeLessThan(withoutRepeat.rawScore);
  });
});

describe("scoreIngredientReuse", () => {
  it("neutral (0), wenn im Plan noch keine Zutaten verwendet wurden", () => {
    expect(scoreIngredientReuse(recipe(), ctx()).rawScore).toBe(0);
  });

  it("positiv, wenn eine Zutat bereits im Plan verwendet wird", () => {
    const result = scoreIngredientReuse(recipe(), ctx({ usedIngredientsInPlan: new Set(["Reis"]) }));
    expect(result.rawScore).toBeGreaterThan(0);
  });
});

describe("mainIngredientToken", () => {
  it("extrahiert die Hauptzutat ohne Mengenangabe", () => {
    expect(mainIngredientToken(["200g Hähnchenbrust", "100g Reis"])).toBe("hähnchenbrust");
  });

  it("gibt null für eine leere Zutatenliste zurück", () => {
    expect(mainIngredientToken([])).toBeNull();
  });
});

describe("scoreCandidate: Gesamtscore", () => {
  it("summiert alle Faktoren zu einem Gesamtscore", () => {
    const { total, factorResults } = scoreCandidate(recipe(), ctx());
    const manualSum = factorResults.reduce((sum, f) => sum + f.weightedScore, 0);
    expect(total).toBeCloseTo(manualSum, 8);
  });

  it("enthält alle in MEAL_PLAN_WEIGHTS definierten Faktoren", () => {
    const { factorResults } = scoreCandidate(recipe(), ctx());
    const factorNames = factorResults.map((f) => f.factor);
    for (const key of Object.keys(MEAL_PLAN_WEIGHTS)) {
      expect(factorNames).toContain(key);
    }
  });
});
