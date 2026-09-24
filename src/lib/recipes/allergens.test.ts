import { describe, expect, it } from "vitest";
import { matchesAllergen } from "../foodMatching";
import { checkHardConstraints } from "../agents/decision/hardConstraints";
import { searchRecipes, type SearchableRecipe } from "../agents/recipeSearch";
import { filterHouseholdCandidates } from "../mealPlanner/hardConstraints";
import { FOODS } from "./data/foods";
import { buildRecipes } from "./data/build";
import {
  CANONICAL_ALLERGENS,
  canonicalizeRecipeAllergens,
  recipeBlockedByAllergies,
  resolveAllergyLabels,
} from "./allergens";

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
    ingredients: ["100 g Reis"],
    tags: [],
    isTrending: false,
    ...overrides,
  };
}

describe("resolveAllergyLabels", () => {
  it("löst 'Erdnüsse' und 'Erdnuss' auf das kanonische Allergen 'erdnuss' auf", () => {
    expect([...resolveAllergyLabels(["Erdnüsse"]).allergens]).toEqual(["erdnuss"]);
    expect([...resolveAllergyLabels(["Erdnuss"]).allergens]).toEqual(["erdnuss"]);
    expect([...resolveAllergyLabels(["ERDNÜSSE"]).allergens]).toEqual(["erdnuss"]);
    expect([...resolveAllergyLabels(["Erdnuß"]).allergens]).toEqual(["erdnuss"]);
  });

  it.each([
    ["Laktose", "milch"],
    ["Milch", "milch"],
    ["Milchprodukte", "milch"],
    ["Soja", "soja"],
    ["Gluten", "gluten"],
    ["Ei", "ei"],
    ["Eier", "ei"],
    ["Fisch", "fisch"],
    ["Sesam", "sesam"],
  ])("'%s' -> %s", (label, expected) => {
    expect([...resolveAllergyLabels([label]).allergens]).toEqual([expected]);
  });

  it("'Nüsse' ist ein Oberbegriff und sperrt vorsorglich auch Erdnuss; konkrete Baumnüsse nicht", () => {
    expect([...resolveAllergyLabels(["Nüsse"]).allergens].sort()).toEqual(["erdnuss", "nüsse"]);
    expect([...resolveAllergyLabels(["Walnüsse"]).allergens]).toEqual(["nüsse"]);
  });

  it("versteht Zusätze wie 'Allergie' und mehrere Begriffe in einem Label", () => {
    expect([...resolveAllergyLabels(["Erdnuss-Allergie"]).allergens]).toEqual(["erdnuss"]);
    expect([...resolveAllergyLabels(["Erdnussallergie"]).allergens]).toEqual(["erdnuss"]);
    expect([...resolveAllergyLabels(["Allergie gegen Milch und Eier"]).allergens].sort()).toEqual(["ei", "milch"]);
  });

  it("meldet unbekannte Begriffe als unaufgelöst, statt sie zu verwerfen", () => {
    const resolved = resolveAllergyLabels(["Sellerie", "Erdnüsse"]);
    expect([...resolved.allergens]).toEqual(["erdnuss"]);
    expect(resolved.unresolvedTerms).toEqual(["sellerie"]);
  });

  it("erfindet keine Allergene: 'Ei' meint nicht 'Weizen' und leere Angaben bleiben leer", () => {
    expect([...resolveAllergyLabels(["Weizen"]).allergens]).toEqual(["gluten"]);
    expect([...resolveAllergyLabels([""]).allergens]).toEqual([]);
    expect(resolveAllergyLabels([]).unresolvedTerms).toEqual([]);
  });
});

describe("canonicalizeRecipeAllergens", () => {
  it("bildet Rezept-Allergene auf dieselben kanonischen Begriffe ab", () => {
    expect([...canonicalizeRecipeAllergens(["erdnuss", "nüsse", "milch"]).canonical].sort()).toEqual(["erdnuss", "milch", "nüsse"]);
    expect([...canonicalizeRecipeAllergens(["nuts"]).canonical]).toEqual(["nüsse"]);
  });

  it("der Oberbegriff 'nüsse' auf der Rezeptseite meint nur Baumnüsse, nicht Erdnuss", () => {
    expect([...canonicalizeRecipeAllergens(["nüsse"]).canonical]).toEqual(["nüsse"]);
  });

  it("behält unbekannte Angaben als normalisierten Text", () => {
    expect(canonicalizeRecipeAllergens(["Sellerie"]).other).toEqual(["sellerie"]);
  });
});

describe("Allergie-Regression: 'Erdnüsse' gegen das Allergen 'erdnuss'", () => {
  it("matchesAllergen erkennt den Treffer", () => {
    expect(matchesAllergen(["erdnuss"], ["Erdnüsse"])).toBe(true);
    expect(matchesAllergen(["erdnuss", "gluten"], ["Erdnüsse"])).toBe(true);
  });

  it("ohne Treffer bleibt ein Rezept erlaubt", () => {
    expect(matchesAllergen(["gluten"], ["Erdnüsse"])).toBe(false);
    expect(matchesAllergen([], ["Erdnüsse"])).toBe(false);
    expect(matchesAllergen(["erdnuss"], [])).toBe(false);
  });

  it("Hard Constraint: das Rezept ist blockiert", () => {
    const peanut = recipe({ allergens: ["erdnuss"], ingredients: ["50 g Erdnussbutter"] });
    const violations = checkHardConstraints(peanut, { allergies: ["Erdnüsse"], dietType: "OMNIVORE", excludedIngredients: [] });
    expect(violations.map((v) => v.constraint)).toEqual(["allergies"]);
  });

  it("Recipe Search: das Rezept kommt nicht in die Trefferliste", () => {
    const peanut = recipe({ id: "peanut", allergens: ["erdnuss"] });
    const safe = recipe({ id: "safe" });
    const ids = searchRecipes({ allergies: ["Erdnüsse"] }, [peanut, safe]).map((m) => m.recipe.id);
    expect(ids).toEqual(["safe"]);
  });

  it("Haushalts-Planer: das Rezept kommt nicht in den sicheren Kandidatenpool", () => {
    const peanut = recipe({ id: "peanut", allergens: ["erdnuss"] });
    const safe = recipe({ id: "safe" });
    const member = {
      householdMemberId: "m1",
      profileId: "p1",
      name: "Test",
      dietType: "OMNIVORE" as const,
      allergies: ["Erdnüsse"],
      likedFoods: [],
      dislikedFoods: [],
      fullDailyTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
      remainingTodayTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
    };
    const { allowed, rejected } = filterHouseholdCandidates([peanut, safe], [member], []);
    expect(allowed.map((r) => r.id)).toEqual(["safe"]);
    expect(rejected.get("peanut")?.[0]).toMatchObject({ constraint: "allergies", householdMemberId: "m1" });
  });

  it("ein Mitglied mit Allergie sperrt das Rezept für die gemeinsame Planung, auch wenn ein anderes keine hat", () => {
    const peanut = recipe({ id: "peanut", allergens: ["erdnuss"] });
    const base = {
      profileId: "p",
      name: null,
      dietType: "OMNIVORE" as const,
      likedFoods: [],
      dislikedFoods: [],
      fullDailyTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
      remainingTodayTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
    };
    const { allowed } = filterHouseholdCandidates(
      [peanut],
      [
        { ...base, householdMemberId: "a", allergies: [] },
        { ...base, householdMemberId: "b", allergies: ["Erdnüsse"] },
      ],
      [],
    );
    expect(allowed).toEqual([]);
  });
});

describe("unbekannte Begriffe gelten nie als sicher", () => {
  it("prüft ein Label ohne Eintrag im Vokabular als Text gegen die Zutaten", () => {
    expect(recipeBlockedByAllergies([], ["Sellerie"], ["1 Stück Sellerie", "2 EL Öl"])).toBe(true);
    expect(recipeBlockedByAllergies([], ["Sellerie"], ["2 EL Öl"])).toBe(false);
  });

  it("prüft es auch gegen unbekannte Rezept-Allergene", () => {
    expect(recipeBlockedByAllergies(["Sellerie"], ["Sellerie"])).toBe(true);
    expect(recipeBlockedByAllergies(["sellerie (spuren)"], ["Sellerie"])).toBe(true);
  });

  it("ein aufgelöstes Label wird nicht zusätzlich gegen den Zutatentext geprüft (kein Kokosmilch-Fehlalarm bei Milch)", () => {
    expect(recipeBlockedByAllergies([], ["Milch"], ["200 ml Kokosmilch"])).toBe(false);
  });
});

describe("Vokabular der Daten", () => {
  it("jedes Allergen der Seed-Foods und der 60 Seed-Rezepte ist ein kanonischer Begriff", () => {
    const vocabulary = new Set<string>([...CANONICAL_ALLERGENS]);
    const seedAllergens = new Set([...FOODS.flatMap((f) => f.allergens ?? []), ...buildRecipes().flatMap((r) => r.allergens)]);
    expect([...seedAllergens].filter((a) => !vocabulary.has(a))).toEqual([]);
  });

  it("jeder kanonische Begriff lässt sich als Nutzer-Allergie eingeben und trifft ein Rezept mit genau diesem Allergen", () => {
    for (const allergen of CANONICAL_ALLERGENS) {
      expect(recipeBlockedByAllergies([allergen], [allergen])).toBe(true);
    }
  });

  it("die Seed-Rezepte mit Erdnuss-Allergen werden für 'Erdnüsse' alle gesperrt", () => {
    const peanut = buildRecipes().filter((r) => r.allergens.includes("erdnuss"));
    expect(peanut.length).toBeGreaterThan(0);
    for (const r of peanut) expect(matchesAllergen(r.allergens, ["Erdnüsse"], r.ingredientLines)).toBe(true);
  });
});
