import { describe, expect, it } from "vitest";
import { matchesAllergen } from "../foodMatching";
import { checkHardConstraints } from "../agents/decision/hardConstraints";
import { searchRecipes, type SearchableRecipe } from "../agents/recipeSearch";
import { filterHouseholdCandidates } from "../mealPlanner/hardConstraints";
import { FOODS } from "./data/foods";
import { buildRecipes, buildSeedCatalog } from "./data/build";
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

  it("ein aufgelöstes Label prüft den Zutatentext ohne Fehlalarm: Kokosmilch ist keine Milch", () => {
    expect(recipeBlockedByAllergies([], ["Milch"], ["200 ml Kokosmilch"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F-03 (R2): eigene und Altrezepte tragen von Hand gepflegte Allergene, die fehlen können.
// Die Zutatenzeilen zählen deshalb ebenfalls - über den FoodCatalog und das Allergen-Vokabular.
// ---------------------------------------------------------------------------

const catalog = buildSeedCatalog();

function member(id: string, allergies: string[]) {
  return {
    householdMemberId: id,
    profileId: `profile-${id}`,
    name: id,
    dietType: "OMNIVORE" as const,
    allergies,
    likedFoods: [],
    dislikedFoods: [],
    fullDailyTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
    remainingTodayTarget: { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 },
  };
}

/** Ein eigenes Rezept, dessen Autor keine Allergene angegeben hat. */
const peanutToast = recipe({ id: "custom-peanut", allergens: [], ingredients: ["2 EL Erdnussbutter", "2 Scheiben Vollkorntoast"] });
const riceBowl = recipe({ id: "custom-rice", allergens: [], ingredients: ["150 g Reis", "2 Tomaten", "1 Zucchini", "2 EL Olivenöl"] });

describe("F-03 Fall A: Katalogrezepte mit abgeleiteten Allergenen behalten ihr Verhalten", () => {
  it("für jedes der 60 Seed-Rezepte und jede Allergie ändern die Zutatenzeilen nichts am Ergebnis", () => {
    const labels = [...CANONICAL_ALLERGENS, "Erdnüsse", "Laktose", "Weizen", "Walnüsse", "Garnelen"];
    const changed: string[] = [];
    for (const r of buildRecipes(catalog)) {
      for (const label of labels) {
        const derivedOnly = recipeBlockedByAllergies(r.allergens, [label]);
        for (const withCatalog of [catalog, undefined]) {
          if (recipeBlockedByAllergies(r.allergens, [label], r.ingredientLines, withCatalog) !== derivedOnly) {
            changed.push(`${r.slug} / ${label} / ${withCatalog ? "mit" : "ohne"} Katalog`);
          }
        }
      }
    }
    expect(changed).toEqual([]);
  });
});

describe("F-03 Fall B: ein angegebenes Allergen sperrt weiterhin", () => {
  it("eigenes Rezept mit angegebenem Erdnuss-Allergen", () => {
    expect(recipeBlockedByAllergies(["erdnuss"], ["Erdnüsse"], ["2 EL Erdnussbutter"], catalog)).toBe(true);
    expect(recipeBlockedByAllergies(["erdnuss"], ["Erdnüsse"], [])).toBe(true);
  });
});

describe("F-03 Fall C: fehlende Allergen-Angabe, aber allergene Zutat", () => {
  it("Erdnussbutter wird mit und ohne Katalog erkannt", () => {
    expect(recipeBlockedByAllergies([], ["Erdnüsse"], peanutToast.ingredients, catalog)).toBe(true);
    expect(recipeBlockedByAllergies([], ["Erdnüsse"], peanutToast.ingredients)).toBe(true);
    expect(matchesAllergen([], ["Erdnüsse"], peanutToast.ingredients, catalog)).toBe(true);
  });

  it.each([
    ["Milch", "150 g Skyr"],
    ["Laktose", "100 g Feta, zerbröselt"],
    ["Soja", "200 g Räuchertofu"],
    ["Gluten", "250 g Spaghetti"],
    ["Fisch", "1 Dose Thunfisch im eigenen Saft"],
    ["Sesam", "2 EL Tahin"],
    ["Eier", "2 Eier"],
  ])("über den FoodCatalog: %s in %s", (allergy, line) => {
    expect(recipeBlockedByAllergies([], [allergy], [line], catalog)).toBe(true);
  });

  it.each([
    ["Gluten", "300 g Weizenmehl"],
    ["Sesam", "1 EL Sesamöl"],
    ["Nüsse", "50 g Haselnusskerne"],
    ["Walnüsse", "30 g Walnusskerne, gehackt"],
    ["Milch", "200 ml Buttermilch"],
    ["Eier", "250 g Eiernudeln"],
    ["Fisch", "2 EL Fischsauce"],
    ["Erdnüsse", "1 EL Erdnussöl"],
  ])("über das Allergen-Vokabular auch in zusammengesetzten Wörtern: %s in %s", (allergy, line) => {
    expect(recipeBlockedByAllergies([], [allergy], [line])).toBe(true);
  });
});

describe("F-03 Fall E: keine unnötigen Fehlalarme", () => {
  it("ein Rezept ohne allergene Zutaten bleibt für alle Allergien erlaubt", () => {
    for (const allergy of [...CANONICAL_ALLERGENS, "Erdnüsse", "Laktose"]) {
      expect(recipeBlockedByAllergies([], [allergy], riceBowl.ingredients, catalog)).toBe(false);
      expect(recipeBlockedByAllergies([], [allergy], riceBowl.ingredients)).toBe(false);
    }
  });

  it.each([
    ["Milch", "200 ml Kokosmilch"],
    ["Milch", "250 ml Hafermilch"],
    ["Milch", "200 ml Mandelmilch"],
    ["Nüsse", "1 Prise Muskatnuss"],
    ["Eier", "1 EL Eiersatz"],
    ["Eier", "1/2 Eisbergsalat"],
    ["Gluten", "1 TL glutenfreies Backpulver"],
    ["Nüsse", "1 Butternusskürbis"],
  ])("kein Treffer für %s in %s", (allergy, line) => {
    expect(recipeBlockedByAllergies([], [allergy], [line], catalog)).toBe(false);
    expect(recipeBlockedByAllergies([], [allergy], [line])).toBe(false);
  });

  it("was der Katalog als Food kennt, zählt mit seinen gepflegten Allergenen: Hafermilch enthält Gluten, Mandelmilch Nüsse", () => {
    expect(recipeBlockedByAllergies([], ["Gluten"], ["250 ml Hafermilch"], catalog)).toBe(true);
    expect(recipeBlockedByAllergies([], ["Nüsse"], ["200 ml Mandelmilch"], catalog)).toBe(true);
  });
});

describe("F-03 Planungs- und Entscheidungspfade", () => {
  it("Decision Engine / Macro Rescue (checkHardConstraints): eigenes Rezept ohne Allergen-Angabe wird gesperrt", () => {
    const violations = checkHardConstraints(peanutToast, { allergies: ["Erdnüsse"], dietType: "OMNIVORE", excludedIngredients: [], catalog });
    expect(violations.map((v) => v.constraint)).toEqual(["allergies"]);
    expect(checkHardConstraints(peanutToast, { allergies: ["Erdnüsse"], dietType: "OMNIVORE", excludedIngredients: [] }).map((v) => v.constraint)).toEqual([
      "allergies",
    ]);
  });

  it("Recipe Search (Food Assistant): das Rezept fehlt in der Trefferliste", () => {
    const ids = searchRecipes({ allergies: ["Erdnüsse"] }, [peanutToast, riceBowl], 5, catalog).map((m) => m.recipe.id);
    expect(ids).toEqual(["custom-rice"]);
  });

  it("Fall D: Haushalts-Planer sperrt das Rezept eines anderen Mitglieds für das allergische Mitglied", () => {
    const { allowed, rejected } = filterHouseholdCandidates([peanutToast, riceBowl], [member("a", []), member("b", ["Erdnüsse"])], [], catalog);
    expect(allowed.map((r) => r.id)).toEqual(["custom-rice"]);
    expect(rejected.get("custom-peanut")).toEqual([expect.objectContaining({ constraint: "allergies", householdMemberId: "b" })]);
  });

  it("die Pfade geben den Food-Katalog weiter: ein Skyr-Rezept ohne Allergen-Angabe fällt bei Milchallergie heraus", () => {
    const skyrBowl = recipe({ id: "custom-skyr", allergens: [], ingredients: ["300 g Skyr", "1 Banane"] });
    expect(checkHardConstraints(skyrBowl, { allergies: ["Milch"], dietType: "OMNIVORE", excludedIngredients: [], catalog }).map((v) => v.constraint)).toEqual([
      "allergies",
    ]);
    expect(searchRecipes({ allergies: ["Milch"] }, [skyrBowl, riceBowl], 5, catalog).map((m) => m.recipe.id)).toEqual(["custom-rice"]);
    expect(filterHouseholdCandidates([skyrBowl, riceBowl], [member("a", []), member("b", ["Laktose"])], [], catalog).allowed.map((r) => r.id)).toEqual([
      "custom-rice",
    ]);
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
