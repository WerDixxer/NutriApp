import { describe, expect, it } from "vitest";
import type { SearchableRecipe } from "../recipeSearch";
import {
  scoreBudget,
  scoreCalories,
  scoreCandidate,
  scoreFiber,
  scoreFoodWaste,
  scoreMacros,
  scorePantry,
  scorePreferences,
  scorePrepTime,
  scoreVariety,
  type ScoringContext,
} from "./softScoring";

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

const baseCtx: ScoringContext = {
  targetKcal: 500,
  targetProteinG: 30,
  targetCarbsG: 50,
  targetFatG: 15,
  likedFoods: [],
  dislikedFoods: [],
  preferences: [],
  recentRecipeCounts: new Map(),
};

describe("scoreCalories", () => {
  it("gibt den höchsten Score für einen exakten Treffer", () => {
    expect(scoreCalories(recipe({ kcal: 500 }), baseCtx).rawScore).toBe(1);
  });

  it("bewertet eine Mahlzeit näher am Ziel besser als eine weiter entfernte (beeinflusst das Ranking)", () => {
    const close = scoreCalories(recipe({ kcal: 520 }), baseCtx).rawScore;
    const far = scoreCalories(recipe({ kcal: 1200 }), baseCtx).rawScore;
    expect(close).toBeGreaterThan(far);
  });

  it("liefert erst ab einer guten Näherung einen Explainability-Grund", () => {
    expect(scoreCalories(recipe({ kcal: 500 }), baseCtx).reason).toBeDefined();
    expect(scoreCalories(recipe({ kcal: 2000 }), baseCtx).reason).toBeUndefined();
  });
});

describe("scoreMacros", () => {
  it("bewertet eine Mahlzeit mit passenden Makros besser als eine mit stark abweichenden (beeinflusst das Ranking)", () => {
    const close = scoreMacros(recipe({ proteinG: 30, carbsG: 50, fatG: 15 }), baseCtx).rawScore;
    const far = scoreMacros(recipe({ proteinG: 2, carbsG: 200, fatG: 80 }), baseCtx).rawScore;
    expect(close).toBeGreaterThan(far);
  });

  it("gibt einen Protein-Grund nur, wenn tatsächlich genug Protein enthalten ist", () => {
    expect(scoreMacros(recipe({ proteinG: 30 }), baseCtx).reason).toBeDefined();
    expect(scoreMacros(recipe({ proteinG: 1 }), baseCtx).reason).toBeUndefined();
  });
});

describe("Faktoren ohne verfügbare Datenquelle (kein erfundener Wert)", () => {
  it("scoreFiber ist neutral (0), keine erfundenen Ballaststoff-Daten", () => {
    const result = scoreFiber();
    expect(result.rawScore).toBe(0);
    expect(result.weightedScore).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it("scoreFoodWaste ist neutral (0), wenn keine dringenden Pantry Items bekannt sind", () => {
    const result = scoreFoodWaste(recipe(), baseCtx);
    expect(result.rawScore).toBe(0);
  });

  it("scoreFoodWaste belohnt ein Rezept, das ein dringendes Pantry Item verwertet", () => {
    const ctx: ScoringContext = { ...baseCtx, urgentPantryIngredientNames: ["Reis"] };
    const result = scoreFoodWaste(recipe({ ingredients: ["200 g Reis"] }), ctx);
    expect(result.rawScore).toBe(1);
    expect(result.reason).toContain("bald ablaufen");
  });

  it("scoreBudget ist neutral (0), kein Preis-/Budget-Modell", () => {
    const result = scoreBudget();
    expect(result.rawScore).toBe(0);
  });
});

describe("scorePantry", () => {
  it("ist neutral (0), wenn keine Zutaten-Angaben vorhanden sind, und wirft keinen Fehler", () => {
    expect(() => scorePantry(recipe(), baseCtx)).not.toThrow();
    const result = scorePantry(recipe(), baseCtx);
    expect(result.rawScore).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it("bewertet einen Kandidaten mit vorhandenen Zutaten positiv, sobald Pantry-Daten (Zutaten aus der Nachricht) vorhanden sind", () => {
    const ctx: ScoringContext = { ...baseCtx, availableIngredients: ["Reis", "Hähnchen"] };
    const result = scorePantry(recipe({ ingredients: ["200 g Reis", "150 g Hähnchen"] }), ctx);
    expect(result.rawScore).toBe(1);
    expect(result.reason).toContain("Reis");
  });

  it("bewertet einen Kandidaten ohne Überschneidung mit 0, ohne Fehler", () => {
    const ctx: ScoringContext = { ...baseCtx, availableIngredients: ["Tofu"] };
    expect(() => scorePantry(recipe({ ingredients: ["200 g Reis"] }), ctx)).not.toThrow();
    expect(scorePantry(recipe({ ingredients: ["200 g Reis"] }), ctx).rawScore).toBe(0);
  });
});

describe("scorePrepTime", () => {
  it("bewertet ein schnelleres Rezept besser als ein langsameres Rezept", () => {
    const fast = scorePrepTime(recipe({ prepTimeMin: 10 }), baseCtx).rawScore;
    const slow = scorePrepTime(recipe({ prepTimeMin: 90 }), baseCtx).rawScore;
    expect(fast).toBeGreaterThan(slow);
  });

  it("gibt einen Grund, wenn die genannte Zeitgrenze eingehalten wird", () => {
    const ctx: ScoringContext = { ...baseCtx, maxCookingTimeMin: 20 };
    expect(scorePrepTime(recipe({ prepTimeMin: 15 }), ctx).reason).toBeDefined();
    expect(scorePrepTime(recipe({ prepTimeMin: 45 }), ctx).reason).toBeUndefined();
  });
});

describe("scorePreferences", () => {
  it("bestraft eine als Abneigung markierte Zutat", () => {
    const ctx: ScoringContext = { ...baseCtx, dislikedFoods: ["Rosenkohl"] };
    const result = scorePreferences(recipe({ ingredients: ["200 g Rosenkohl"] }), ctx);
    expect(result.rawScore).toBeLessThan(0);
  });

  it("belohnt ein genanntes Lieblingsessen", () => {
    const ctx: ScoringContext = { ...baseCtx, likedFoods: ["Hähnchen"] };
    const result = scorePreferences(recipe({ ingredients: ["150 g Hähnchen"] }), ctx);
    expect(result.rawScore).toBeGreaterThan(0);
    expect(result.reason).toBeDefined();
  });
});

describe("scoreVariety", () => {
  it("bewertet ein kürzlich mehrfach gegessenes Rezept niedriger", () => {
    const ctx: ScoringContext = { ...baseCtx, recentRecipeCounts: new Map([["r1", 3]]) };
    const result = scoreVariety(recipe({ id: "r1" }), ctx);
    expect(result.rawScore).toBeLessThan(1);
  });

  it("bewertet ein noch nicht kürzlich gegessenes Rezept mit dem vollen Score", () => {
    expect(scoreVariety(recipe({ id: "r2" }), baseCtx).rawScore).toBe(1);
  });
});

describe("scoreCandidate", () => {
  it("summiert alle Faktoren zu einem Gesamtscore und liefert alle Einzelergebnisse", () => {
    const { total, factorResults } = scoreCandidate(recipe(), baseCtx);
    expect(factorResults).toHaveLength(9);
    expect(total).toBeGreaterThan(0);
  });
});
