import { describe, expect, it } from "vitest";
import { checkHouseholdHardConstraints, filterHouseholdCandidates } from "./hardConstraints";
import type { MemberPlanningContext } from "./types";
import type { SearchableRecipe } from "../agents/recipeSearch";

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
    ingredients: ["200g Hähnchenbrust", "100g Reis"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

function member(overrides: Partial<MemberPlanningContext> = {}): MemberPlanningContext {
  return {
    householdMemberId: "member-1",
    profileId: "profile-1",
    name: "Vincenzo",
    dietType: "OMNIVORE",
    allergies: [],
    likedFoods: [],
    dislikedFoods: [],
    fullDailyTarget: { kcal: 2500, proteinG: 160, carbsG: 280, fatG: 75 },
    remainingTodayTarget: { kcal: 2500, proteinG: 160, carbsG: 280, fatG: 75 },
    ...overrides,
  };
}

describe("checkHouseholdHardConstraints: mehrere Personen", () => {
  it("keine Verstöße, wenn alle Mitglieder das Rezept vertragen", () => {
    const violations = checkHouseholdHardConstraints(recipe(), [member()], []);
    expect(violations).toEqual([]);
  });

  it("ein Allergie-Verstoß bei EINEM von mehreren Mitgliedern lehnt das Rezept für den ganzen Haushalt ab", () => {
    const partner = member({ householdMemberId: "member-2", name: "Partner", allergies: ["Nüsse"] });
    const violations = checkHouseholdHardConstraints(recipe({ allergens: ["Nüsse"] }), [member(), partner], []);
    expect(violations).toHaveLength(1);
    expect(violations[0].householdMemberId).toBe("member-2");
    expect(violations[0].constraint).toBe("allergies");
  });

  it("ein Dietary-Style-Verstoß bei einem veganen Mitglied lehnt ein Fleischrezept ab", () => {
    const vegan = member({ householdMemberId: "member-2", dietType: "VEGAN" });
    const violations = checkHouseholdHardConstraints(recipe({ dietTypes: ["OMNIVORE"] }), [member(), vegan], []);
    expect(violations.some((v) => v.constraint === "dietaryStyle" && v.householdMemberId === "member-2")).toBe(true);
  });

  it("explizite Ausschlüsse gelten Plan-weit für alle Mitglieder", () => {
    const violations = checkHouseholdHardConstraints(recipe({ ingredients: ["200g Pilze"] }), [member()], ["Pilze"]);
    expect(violations.some((v) => v.constraint === "excludedIngredients")).toBe(true);
  });

  it("sammelt Verstöße mehrerer Mitglieder gleichzeitig, nicht nur den ersten", () => {
    const allergicPartner = member({ householdMemberId: "member-2", allergies: ["Nüsse"] });
    const veganChild = member({ householdMemberId: "member-3", dietType: "VEGAN" });
    const violations = checkHouseholdHardConstraints(
      recipe({ allergens: ["Nüsse"], dietTypes: ["OMNIVORE"] }),
      [member(), allergicPartner, veganChild],
      [],
    );
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("filterHouseholdCandidates", () => {
  it("teilt Kandidaten in erlaubt/abgelehnt auf", () => {
    const safe = recipe({ id: "safe" });
    const unsafe = recipe({ id: "unsafe", allergens: ["Nüsse"] });
    const partner = member({ householdMemberId: "member-2", allergies: ["Nüsse"] });

    const { allowed, rejected } = filterHouseholdCandidates([safe, unsafe], [member(), partner], []);
    expect(allowed.map((r) => r.id)).toEqual(["safe"]);
    expect(rejected.has("unsafe")).toBe(true);
  });

  it("liefert eine leere allowed-Liste, wenn kein Rezept passt, ohne Fehler", () => {
    const unsafe = recipe({ allergens: ["Nüsse"] });
    const partner = member({ householdMemberId: "member-2", allergies: ["Nüsse"] });
    const { allowed } = filterHouseholdCandidates([unsafe], [member(), partner], []);
    expect(allowed).toEqual([]);
  });

  it("funktioniert mit einer leeren Kandidatenliste", () => {
    const { allowed, rejected } = filterHouseholdCandidates([], [member()], []);
    expect(allowed).toEqual([]);
    expect(rejected.size).toBe(0);
  });
});
