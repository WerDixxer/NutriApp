import { describe, expect, it } from "vitest";
import { validateGeneratedPlan } from "./validatePlan";
import type { GeneratedMealPlan, MemberPlanningContext, PlanningContext } from "./types";
import type { SearchableRecipe } from "../agents/recipeSearch";
import { buildSeedCatalog } from "../recipes/data/build";
import { createFoodPreferenceContext } from "../recipes/foodPreferences";

const now = new Date("2026-09-17T12:00:00");

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    id: "recipe-1",
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
    ingredients: ["200g Hähnchenbrust"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

function member(overrides: Partial<MemberPlanningContext> = {}): MemberPlanningContext {
  const target = { kcal: 2200, proteinG: 150, carbsG: 220, fatG: 70 };
  return {
    householdMemberId: "member-1",
    profileId: "profile-1",
    name: "Vincenzo",
    dietType: "OMNIVORE",
    allergies: [],
    likedFoods: [],
    dislikedFoods: [],
    fullDailyTarget: target,
    remainingTodayTarget: target,
    ...overrides,
  };
}

function context(overrides: Partial<PlanningContext> = {}): PlanningContext {
  return {
    householdId: "household-A",
    members: [member()],
    excludedIngredients: [],
    pantry: { availableIngredientNames: [], urgentIngredientNames: [] },
    budget: { remainingWeekBudgetCents: null, remainingMonthBudgetCents: null },
    candidates: [recipe()],
    recentRecipeCounts: new Map(),
    ...overrides,
  };
}

const input = { startDate: now, days: 1, slots: ["LUNCH"] as const };

function plan(overrides: Partial<GeneratedMealPlan> = {}): GeneratedMealPlan {
  return {
    status: "SUCCESS",
    meals: [{ date: now, slot: "LUNCH", recipeId: "recipe-1", recipeName: "Testrezept", portionMultiplier: 1, reasons: [] }],
    unmetSlots: [],
    ...overrides,
  };
}

describe("validateGeneratedPlan: gültiger Plan", () => {
  it("liefert keine Fehler für einen vollständig gültigen Plan", () => {
    const errors = validateGeneratedPlan(plan(), context(), { ...input, slots: [...input.slots] });
    expect(errors).toEqual([]);
  });
});

describe("validateGeneratedPlan: Allergien über den Food-Katalog (F-03)", () => {
  it("meldet ein eigenes Skyr-Rezept ohne Allergen-Angabe für ein Mitglied mit Milchallergie", () => {
    const skyr = recipe({ allergens: [], ingredients: ["300 g Skyr"] });
    const ctx = context({
      members: [member({ allergies: ["Milch"] })],
      candidates: [skyr],
      foodPreferences: createFoodPreferenceContext({ favoriteFoods: [], dislikedFoods: [] }, buildSeedCatalog()),
    });
    const errors = validateGeneratedPlan(plan(), ctx, { ...input, slots: [...input.slots] });
    expect(errors.map((e) => e.message)).toEqual([expect.stringContaining("Verletzt Hard Constraints")]);
  });
});

describe("validateGeneratedPlan: Hard-Constraint-Verstoß wird NIE durchgelassen", () => {
  it("lehnt eine Mahlzeit ab, die ein Allergen eines Mitglieds enthält", () => {
    const ctx = context({ members: [member({ allergies: ["Hähnchen"] })], candidates: [recipe({ allergens: ["Hähnchen"] })] });
    const errors = validateGeneratedPlan(plan(), ctx, { ...input, slots: [...input.slots] });
    expect(errors.some((e) => e.message.includes("Hard Constraints"))).toBe(true);
  });
});

describe("validateGeneratedPlan: Rezept-Existenz", () => {
  it("lehnt eine Mahlzeit mit einem Rezept ab, das nicht (mehr) im Kandidaten-Pool ist", () => {
    const errors = validateGeneratedPlan(plan({ meals: [{ date: now, slot: "LUNCH", recipeId: "does-not-exist", recipeName: "X", portionMultiplier: 1, reasons: [] }] }), context(), {
      ...input,
      slots: [...input.slots],
    });
    expect(errors.some((e) => e.message.includes("existiert nicht"))).toBe(true);
  });
});

describe("validateGeneratedPlan: Portionsgröße", () => {
  it("lehnt eine Portion von 0 oder negativ ab", () => {
    const errors = validateGeneratedPlan(plan({ meals: [{ date: now, slot: "LUNCH", recipeId: "recipe-1", recipeName: "X", portionMultiplier: 0, reasons: [] }] }), context(), {
      ...input,
      slots: [...input.slots],
    });
    expect(errors.some((e) => e.message.includes("Portionsgröße"))).toBe(true);
  });

  it("lehnt eine nicht-endliche Portion ab (z.B. NaN)", () => {
    const errors = validateGeneratedPlan(plan({ meals: [{ date: now, slot: "LUNCH", recipeId: "recipe-1", recipeName: "X", portionMultiplier: NaN, reasons: [] }] }), context(), {
      ...input,
      slots: [...input.slots],
    });
    expect(errors.some((e) => e.message.includes("Portionsgröße"))).toBe(true);
  });
});

describe("validateGeneratedPlan: Datum/Slot außerhalb des Zeitraums", () => {
  it("lehnt ein Datum außerhalb des Planungszeitraums ab", () => {
    const farFuture = new Date("2027-01-01");
    const errors = validateGeneratedPlan(plan({ meals: [{ date: farFuture, slot: "LUNCH", recipeId: "recipe-1", recipeName: "X", portionMultiplier: 1, reasons: [] }] }), context(), {
      ...input,
      slots: [...input.slots],
    });
    expect(errors.some((e) => e.message.includes("Planungszeitraums"))).toBe(true);
  });

  it("lehnt einen nicht angeforderten Slot ab", () => {
    const errors = validateGeneratedPlan(plan({ meals: [{ date: now, slot: "DINNER", recipeId: "recipe-1", recipeName: "X", portionMultiplier: 1, reasons: [] }] }), context(), {
      ...input,
      slots: [...input.slots],
    });
    expect(errors.some((e) => e.message.includes("nicht angefordert"))).toBe(true);
  });
});

describe("validateGeneratedPlan: kein Haushaltsmitglied", () => {
  it("lehnt einen Plan ohne jedes gültige Mitglied ab", () => {
    const errors = validateGeneratedPlan(plan(), context({ members: [] }), { ...input, slots: [...input.slots] });
    expect(errors.some((e) => e.message.includes("Haushaltsmitglied"))).toBe(true);
  });
});
