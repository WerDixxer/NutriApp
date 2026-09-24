import { describe, expect, it } from "vitest";
import { scoreFoodWaste as decisionFoodWaste, scorePantry as decisionPantry, type ScoringContext } from "../agents/decision/softScoring";
import type { SearchableRecipe } from "../agents/recipeSearch";
import { detectMealIngredientExpiresBeforeMeal } from "../insights/detectors/mealPlanDetectors";
import { pantryItemMatchesIngredient, type PantryItemForMatch } from "../mealPrep/enrichment";
import { scoreFoodWaste, scorePantry, type MealSlotScoringContext } from "../mealPlanner/softScoring";
import { buildRecipes, buildSeedCatalog } from "../recipes/data/build";
import { calculateWeeklyShopping } from "../shopping/weeklyShopping";
import { buildPantryFoodIdsByName } from "./pantryFoods";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

function candidate(slug: string): SearchableRecipe {
  const recipe = built.find((r) => r.slug === slug);
  if (!recipe) throw new Error(`Seed-Rezept fehlt: ${slug}`);
  return {
    id: slug,
    name: recipe.name,
    description: recipe.description,
    kcal: recipe.nutrition.kcal,
    proteinG: recipe.nutrition.proteinG,
    carbsG: recipe.nutrition.carbsG,
    fatG: recipe.nutrition.fatG,
    prepTimeMin: recipe.totalTimeMin,
    servings: recipe.servings,
    mealSlots: ["LUNCH"],
    dietTypes: ["OMNIVORE"],
    allergens: recipe.allergens,
    ingredients: recipe.ingredientLines,
    structured: recipe.ingredients,
    tags: recipe.tags,
    isTrending: false,
  };
}

function idsFor(...names: string[]) {
  return buildPantryFoodIdsByName(names.map((name) => ({ name })), catalog);
}

function plannerCtx(overrides: Partial<MealSlotScoringContext>): MealSlotScoringContext {
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

function decisionCtx(overrides: Partial<ScoringContext>): ScoringContext {
  return {
    targetKcal: 500,
    targetProteinG: 30,
    targetCarbsG: 50,
    targetFatG: 15,
    likedFoods: [],
    dislikedFoods: [],
    preferences: [],
    recentRecipeCounts: new Map(),
    ...overrides,
  };
}

describe("Food Waste / Rotation: ein dringendes Pantry-Food findet das strukturierte Rezept über die Food-ID", () => {
  it("Household-Planer: 'Paprika' läuft bald ab -> Fajitas (foodId paprika) werden belohnt", () => {
    const ctx = plannerCtx({ urgentPantryIngredientNames: ["Paprika"], pantryFoodIdsByName: idsFor("Paprika") });
    const result = scoreFoodWaste(candidate("chicken-fajitas"), ctx);
    expect(result.rawScore).toBe(1);
    expect(result.reason).toContain("Paprika");
  });

  it("Household-Planer: der Alias 'Hühnchen' im Vorrat findet das Rezept mit Hähnchenbrust (der Textabgleich fand es nicht)", () => {
    const urgent = { urgentPantryIngredientNames: ["Hühnchen"] };
    expect(scoreFoodWaste(candidate("chicken-fajitas"), plannerCtx(urgent)).rawScore).toBe(0);
    expect(scoreFoodWaste(candidate("chicken-fajitas"), plannerCtx({ ...urgent, pantryFoodIdsByName: idsFor("Hühnchen") })).rawScore).toBe(1);
  });

  it("Household-Planer: dringender Reis verwertet KEINE Reiswaffel-Rezepte", () => {
    const ctx = plannerCtx({ urgentPantryIngredientNames: ["Reis"], pantryFoodIdsByName: idsFor("Reis") });
    expect(scoreFoodWaste(candidate("rice-cake-protein-snack"), ctx).rawScore).toBe(0);
    expect(scoreFoodWaste(candidate("applesauce-and-rice-cakes"), ctx).rawScore).toBe(0);
    expect(scoreFoodWaste(candidate("chicken-teriyaki-rice-bowl"), ctx).rawScore).toBe(1);
  });

  it("Decision Engine: derselbe ID-Abgleich für den Food-Waste-Faktor", () => {
    const ctx = decisionCtx({ urgentPantryIngredientNames: ["Reis"], pantryFoodIdsByName: idsFor("Reis") });
    expect(decisionFoodWaste(candidate("rice-cake-protein-snack"), ctx).rawScore).toBe(0);
    expect(decisionFoodWaste(candidate("chicken-teriyaki-rice-bowl"), ctx).rawScore).toBe(1);
  });

  it("freie Zutat (Rosenkohl) verwertet weiter über den Text", () => {
    const fajitas = candidate("chicken-fajitas");
    const withRosenkohl = { ...fajitas, ingredients: [...fajitas.ingredients, "150 g Rosenkohl"] };
    const ctx = plannerCtx({ urgentPantryIngredientNames: ["Rosenkohl"], pantryFoodIdsByName: idsFor("Rosenkohl") });
    expect(scoreFoodWaste(withRosenkohl, ctx).rawScore).toBe(1);
    expect(scoreFoodWaste(fajitas, ctx).rawScore).toBe(0);
  });

  it("Altrezept ohne strukturierte Zutaten: Text-Fallback auch bei einem bekannten Food", () => {
    const legacy: SearchableRecipe = { ...candidate("chicken-fajitas"), structured: undefined, ingredients: ["200 g Hähnchenbrust", "2 Paprika"] };
    const ctx = plannerCtx({ urgentPantryIngredientNames: ["Paprika"], pantryFoodIdsByName: idsFor("Paprika") });
    expect(scoreFoodWaste(legacy, ctx).rawScore).toBe(1);
  });

  it("ohne Food-ID-Map bleibt das bisherige Verhalten (Textabgleich) unverändert", () => {
    const ctx = plannerCtx({ urgentPantryIngredientNames: ["Reis"] });
    expect(scoreFoodWaste(candidate("rice-cake-protein-snack"), ctx).rawScore).toBe(1);
  });
});

describe("Pantry-Faktor: vorhandene Foods über die Food-ID", () => {
  it("Household-Planer: zählt Treffer über IDs und nennt die Pantry-Namen im Grund", () => {
    const ctx = plannerCtx({
      availablePantryIngredientNames: ["Paprika", "Hühnchen", "Rosenkohl"],
      pantryFoodIdsByName: idsFor("Paprika", "Hühnchen", "Rosenkohl"),
    });
    const result = scorePantry(candidate("chicken-fajitas"), ctx);
    expect(result.reason).toContain("Paprika");
    expect(result.reason).toContain("Hühnchen");
    expect(result.reason).not.toContain("Rosenkohl");
    expect(result.rawScore).toBeCloseTo(2 / 3, 5);
  });

  it("Household-Planer: Reis im Vorrat zählt nicht für ein Rezept mit nur Reiswaffeln", () => {
    const ctx = plannerCtx({ availablePantryIngredientNames: ["Reis"], pantryFoodIdsByName: idsFor("Reis") });
    expect(scorePantry(candidate("rice-cake-protein-snack"), ctx).rawScore).toBe(0);
  });

  it("Decision Engine: Anteil der gefundenen Vorräte wird über IDs bestimmt", () => {
    const ctx = decisionCtx({ availableIngredients: ["Paprika", "Reis"], pantryFoodIdsByName: idsFor("Paprika", "Reis") });
    expect(decisionPantry(candidate("chicken-fajitas"), ctx).rawScore).toBe(0.5);
  });

  it("Decision Engine: vom Nutzer genannte Zutaten ohne Pantry-Eintrag bleiben Text-Abgleich", () => {
    const ctx = decisionCtx({ availableIngredients: ["Paprika", "Zucchini"], pantryFoodIdsByName: idsFor("Paprika") });
    const withZucchini = { ...candidate("chicken-fajitas"), ingredients: [...candidate("chicken-fajitas").ingredients, "1 Zucchini"] };
    expect(decisionPantry(withZucchini, ctx).rawScore).toBe(1);
  });
});

function pantryItem(overrides: Partial<PantryItemForMatch>): PantryItemForMatch {
  return { id: "p1", name: "Reis", remainingQuantity: 500, unit: "G", ...overrides };
}

describe("pantryItemMatchesIngredient (Meal Prep, Einkaufsliste, Insights)", () => {
  it("Food-ID: Alias im Vorrat deckt den kanonischen Namen im Rezept", () => {
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Hühnchen" }), "hähnchenbrust", catalog)).toBe(true);
  });

  it("Food-ID: verknüpftes ingredientId genügt auch bei abweichendem Namen", () => {
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Mein Vorrat", ingredientId: "paprika" }), "paprika", catalog)).toBe(true);
  });

  it("'Reis' im Vorrat deckt nie 'Reiswaffeln' im Rezept (und umgekehrt)", () => {
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Reis" }), "reiswaffeln", catalog)).toBe(false);
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Reiswaffeln" }), "reis", catalog)).toBe(false);
  });

  it("freie Zutaten: exakter Namensabgleich wie bisher", () => {
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Rosenkohl" }), "rosenkohl", catalog)).toBe(true);
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Rosenkohl" }), "blumenkohl", catalog)).toBe(false);
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Algen" }), "algen", catalog)).toBe(true);
  });

  it("ohne Katalog: der bisherige exakte Namensabgleich", () => {
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Hühnchen" }), "hähnchenbrust")).toBe(false);
    expect(pantryItemMatchesIngredient(pantryItem({ name: "Reis" }), "reis")).toBe(true);
  });
});

describe("Einkaufsliste: Vorrat wird über das zentrale Food abgezogen", () => {
  const meals = [
    {
      id: "m1",
      date: new Date("2026-09-21"),
      slot: "LUNCH",
      recipeId: "r1",
      recipeName: "Hähnchen-Bowl",
      ingredients: ["200 g Hähnchenbrust", "150 g Reis"],
      portionMultiplier: 1,
    },
  ];

  it("'Hühnchen' im Vorrat (Alias) deckt 'Hähnchenbrust' im Rezept; ohne Katalog bliebe alles fehlend", () => {
    const pantry = [pantryItem({ id: "p1", name: "Hühnchen", remainingQuantity: 500 })];
    const withCatalog = calculateWeeklyShopping(meals, pantry, new Map(), catalog).items.find((i) => i.ingredientName === "Hähnchenbrust");
    const withoutCatalog = calculateWeeklyShopping(meals, pantry).items.find((i) => i.ingredientName === "Hähnchenbrust");
    expect(withCatalog).toMatchObject({ availableQuantity: 500, missingQuantity: 0 });
    expect(withoutCatalog).toMatchObject({ availableQuantity: 0, missingQuantity: 200 });
  });

  it("Reiswaffeln im Vorrat decken keinen Reis", () => {
    const pantry = [pantryItem({ id: "p2", name: "Reiswaffeln", remainingQuantity: 500 })];
    const rice = calculateWeeklyShopping(meals, pantry, new Map(), catalog).items.find((i) => i.ingredientName === "Reis");
    expect(rice).toMatchObject({ availableQuantity: 0, missingQuantity: 150 });
  });

  it("Vorrat in nicht umrechenbarer Einheit wird über dieselbe ID-Zuordnung erkannt", () => {
    const pantry = [pantryItem({ id: "p3", name: "Hühnchen", remainingQuantity: 2, unit: "PIECE" })];
    const chicken = calculateWeeklyShopping(meals, pantry, new Map(), catalog).items.find((i) => i.ingredientName === "Hähnchenbrust");
    expect(chicken?.hasIncomparablePantryStock).toBe(true);
    expect(chicken?.availableQuantity).toBe(0);
  });
});

describe("Insights: ablaufender Vorrat vor der geplanten Mahlzeit", () => {
  const meal = {
    id: "meal-1",
    date: new Date("2026-09-25T12:00:00Z"),
    slot: "DINNER",
    recipeId: "r1",
    recipeName: "Hähnchen-Bowl",
    ingredients: ["200 g Hähnchenbrust"],
    portionMultiplier: 1,
  };
  const stock = [
    {
      id: "p1",
      name: "Hühnchen",
      remainingQuantity: 500,
      unit: "G" as const,
      expirationDate: new Date("2026-09-23T12:00:00Z"),
    },
  ];

  it("erkennt den Konflikt über das kanonische Food, wenn ein Katalog vorliegt", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(detectMealIngredientExpiresBeforeMeal([meal], stock, now, catalog)).toHaveLength(1);
    expect(detectMealIngredientExpiresBeforeMeal([meal], stock, now)).toHaveLength(0);
  });
});
