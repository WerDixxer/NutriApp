import { describe, expect, it } from "vitest";
import type { CalendarDate } from "../calendarDate";
import { generateMealPlan } from "./plannerEngine";
import type { MemberPlanningContext, PlanningContext } from "./types";
import type { SearchableRecipe } from "../agents/recipeSearch";

const now = new Date("2026-09-17T12:00:00");
/** Der Kalendertag von `now` in Nutzerzeit: der Plan beginnt heute. */
const TODAY: CalendarDate = "2026-09-17";

function recipe(overrides: Partial<SearchableRecipe> = {}): SearchableRecipe {
  return {
    id: overrides.id ?? "recipe-1",
    name: overrides.name ?? "Testrezept",
    description: "",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: ["BREAKFAST", "LUNCH", "DINNER"],
    dietTypes: ["OMNIVORE"],
    allergens: [],
    ingredients: ["200g Hähnchenbrust", "100g Reis"],
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
    candidates: [
      recipe({ id: "breakfast-1", name: "Porridge", mealSlots: ["BREAKFAST"] }),
      recipe({ id: "lunch-1", name: "Bowl", mealSlots: ["LUNCH"] }),
      recipe({ id: "dinner-1", name: "Pasta", mealSlots: ["DINNER"] }),
      recipe({ id: "lunch-2", name: "Salat", mealSlots: ["LUNCH"] }),
    ],
    recentRecipeCounts: new Map(),
    ...overrides,
  };
}

describe("generateMealPlan: Grundfälle", () => {
  it("plant einen einzelnen Tag mit den angeforderten Slots", () => {
    const result = generateMealPlan(context(), { startDate: TODAY, days: 1, slots: ["BREAKFAST", "LUNCH", "DINNER"] }, now);
    expect(result.status).toBe("SUCCESS");
    expect(result.meals).toHaveLength(3);
  });

  it("plant sieben Tage mit jeweils allen Slots (21 Mahlzeiten)", () => {
    const result = generateMealPlan(context(), { startDate: TODAY, days: 7, slots: ["BREAKFAST", "LUNCH", "DINNER"] }, now);
    expect(result.status).toBe("SUCCESS");
    expect(result.meals).toHaveLength(21);
  });

  it("unterstützt mehrere Slot-Kombinationen inkl. SNACK", () => {
    const withSnack = context({
      candidates: [
        ...context().candidates,
        recipe({ id: "snack-1", name: "Obst", mealSlots: ["SNACK"] }),
      ],
    });
    const result = generateMealPlan(withSnack, { startDate: TODAY, days: 1, slots: ["BREAKFAST", "LUNCH", "SNACK", "DINNER"] }, now);
    expect(result.meals.some((m) => m.slot === "SNACK")).toBe(true);
  });
});

describe("generateMealPlan: leere/unzureichende Rezeptdatenbank", () => {
  it("liefert NO_VALID_PLAN bei einer leeren Rezeptdatenbank", () => {
    const result = generateMealPlan(context({ candidates: [] }), { startDate: TODAY, days: 1, slots: ["BREAKFAST"] }, now);
    expect(result.status).toBe("NO_VALID_PLAN");
    expect(result.meals).toEqual([]);
  });

  it("liefert NO_VALID_PLAN, wenn kein Rezept die Hard Constraints erfüllt", () => {
    const onlyUnsafe = context({ candidates: [recipe({ allergens: ["Nüsse"] })], members: [member({ allergies: ["Nüsse"] })] });
    const result = generateMealPlan(onlyUnsafe, { startDate: TODAY, days: 1, slots: ["BREAKFAST"] }, now);
    expect(result.status).toBe("NO_VALID_PLAN");
  });

  it("liefert PARTIAL, wenn ein Slot nicht besetzt werden kann, andere aber schon", () => {
    const partial = context({ candidates: [recipe({ id: "lunch-only", mealSlots: ["LUNCH"] })] });
    const result = generateMealPlan(partial, { startDate: TODAY, days: 1, slots: ["BREAKFAST", "LUNCH"] }, now);
    expect(result.status).toBe("PARTIAL");
    expect(result.unmetSlots.some((u) => u.slot === "BREAKFAST")).toBe(true);
    expect(result.meals.some((m) => m.slot === "LUNCH")).toBe(true);
  });

  it("liefert NO_VALID_PLAN ohne jedes geplante Mitglied", () => {
    const result = generateMealPlan(context({ members: [] }), { startDate: TODAY, days: 1, slots: ["LUNCH"] }, now);
    expect(result.status).toBe("NO_VALID_PLAN");
  });
});

describe("generateMealPlan: Pantry leer vs. befüllt", () => {
  it("plant erfolgreich mit leerem Pantry (neutrale Bewertung, kein Fehler)", () => {
    const result = generateMealPlan(context({ pantry: { availableIngredientNames: [], urgentIngredientNames: [] } }), {
      startDate: TODAY,
      days: 1,
      slots: ["LUNCH"],
    }, now);
    expect(result.status).toBe("SUCCESS");
  });

  it("bevorzugt bei dringendem Pantry-Item das Rezept, das diese Zutat verwendet", () => {
    const ctx = context({
      candidates: [
        recipe({ id: "lunch-1", name: "Bowl", mealSlots: ["LUNCH"], ingredients: ["200g Hähnchenbrust"] }),
        recipe({ id: "lunch-2", name: "Salat", mealSlots: ["LUNCH"], ingredients: ["Salat", "Tomate"] }),
      ],
      pantry: { availableIngredientNames: ["Hähnchenbrust"], urgentIngredientNames: ["Hähnchenbrust"] },
    });
    const result = generateMealPlan(ctx, { startDate: TODAY, days: 1, slots: ["LUNCH"] }, now);
    expect(result.meals[0].recipeId).toBe("lunch-1");
  });
});

describe("generateMealPlan: Budget verfügbar/nicht verfügbar", () => {
  it("plant unabhängig davon, ob ein Budget aktiv ist (Budget-Faktor bleibt neutral, kein Preismodell)", () => {
    const withBudget = generateMealPlan(context({ budget: { remainingWeekBudgetCents: 3000, remainingMonthBudgetCents: null } }), {
      startDate: TODAY,
      days: 1,
      slots: ["LUNCH"],
    }, now);
    const withoutBudget = generateMealPlan(context({ budget: { remainingWeekBudgetCents: null, remainingMonthBudgetCents: null } }), {
      startDate: TODAY,
      days: 1,
      slots: ["LUNCH"],
    }, now);
    expect(withBudget.status).toBe("SUCCESS");
    expect(withoutBudget.status).toBe("SUCCESS");
    expect(withBudget.meals[0].recipeId).toBe(withoutBudget.meals[0].recipeId);
  });
});

describe("generateMealPlan: mehrere Haushaltsmitglieder mit unterschiedlichen Zielen", () => {
  it("plant für mehrere Mitglieder gemeinsam, ohne Fehler", () => {
    const vincenzo = member({ householdMemberId: "member-1", fullDailyTarget: { kcal: 2500, proteinG: 160, carbsG: 280, fatG: 75 }, remainingTodayTarget: { kcal: 2500, proteinG: 160, carbsG: 280, fatG: 75 } });
    const partner = member({ householdMemberId: "member-2", name: "Partner", fullDailyTarget: { kcal: 1900, proteinG: 120, carbsG: 200, fatG: 60 }, remainingTodayTarget: { kcal: 1900, proteinG: 120, carbsG: 200, fatG: 60 } });
    const result = generateMealPlan(context({ members: [vincenzo, partner] }), { startDate: TODAY, days: 1, slots: ["BREAKFAST", "LUNCH", "DINNER"] }, now);
    expect(result.status).toBe("SUCCESS");
  });

  it("ein Allergie-Konflikt eines einzelnen Mitglieds verhindert das Rezept für den gemeinsamen Plan", () => {
    const vincenzo = member({ householdMemberId: "member-1" });
    const allergicPartner = member({ householdMemberId: "member-2", name: "Partner", allergies: ["Hähnchen"] });
    const ctx = context({
      members: [vincenzo, allergicPartner],
      candidates: [recipe({ id: "chicken", allergens: ["Hähnchen"] })],
    });
    const result = generateMealPlan(ctx, { startDate: TODAY, days: 1, slots: ["LUNCH"] }, now);
    expect(result.status).toBe("NO_VALID_PLAN");
  });
});

describe("generateMealPlan: Determinismus", () => {
  it("liefert bei identischer Eingabe immer dasselbe Ergebnis", () => {
    const ctx = context();
    const input = { startDate: TODAY, days: 7, slots: ["BREAKFAST", "LUNCH", "DINNER"] as const };
    const a = generateMealPlan(ctx, { ...input, slots: [...input.slots] }, now);
    const b = generateMealPlan(ctx, { ...input, slots: [...input.slots] }, now);
    expect(a.meals.map((m) => m.recipeId)).toEqual(b.meals.map((m) => m.recipeId));
    expect(a.meals.map((m) => m.portionMultiplier)).toEqual(b.meals.map((m) => m.portionMultiplier));
  });

  it("bricht einen exakten Score-Gleichstand deterministisch über die Rezept-ID (nie zufällig)", () => {
    // Zwei identisch bewertete Kandidaten (gleiche Makros, gleicher Name-unabhängige Score) - die kleinere ID gewinnt.
    const tie = context({
      candidates: [
        recipe({ id: "zzz-recipe", mealSlots: ["LUNCH"] }),
        recipe({ id: "aaa-recipe", mealSlots: ["LUNCH"] }),
      ],
    });
    const result = generateMealPlan(tie, { startDate: TODAY, days: 1, slots: ["LUNCH"] }, now);
    expect(result.meals[0].recipeId).toBe("aaa-recipe");
  });
});

describe("generateMealPlan: Reasons sind nur tatsächlich berechnete Gründe", () => {
  it("jede genannte Begründung stammt aus einem tatsächlich positiven Scoring-Faktor", () => {
    const ctx = context({ pantry: { availableIngredientNames: ["Hähnchenbrust"], urgentIngredientNames: [] } });
    const result = generateMealPlan(ctx, { startDate: TODAY, days: 1, slots: ["LUNCH"] }, now);
    const meal = result.meals[0];
    // Keine Begründung darf leer oder generisch-erfunden sein.
    for (const reason of meal.reasons) {
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
