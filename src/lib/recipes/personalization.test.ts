import { describe, expect, it } from "vitest";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { matchRecipeToPreferences, personalizeRecipe, resolvePreferences } from "./personalization";

const catalog = buildSeedCatalog();
const recipes = new Map(buildRecipes(catalog).map((r) => [r.slug, r]));

function recipe(slug: string) {
  const r = recipes.get(slug);
  if (!r) throw new Error(slug);
  return r;
}

function prefs(favoriteFoods: string[], dislikedFoods: string[] = []) {
  return resolvePreferences({ favoriteFoods, dislikedFoods }, catalog);
}

function matchable(slug: string) {
  const r = recipe(slug);
  return { ingredients: r.ingredients, ingredientLines: r.ingredientLines };
}

describe("Fall 1: Magerquark als Skyr-Alternative (Protein Pancakes)", () => {
  const slug = "protein-pancakes-with-berries";

  it("erkennt das Rezept als relevant, obwohl es Skyr statt Magerquark enthält", () => {
    const match = matchRecipeToPreferences(matchable(slug), prefs(["Magerquark"]), catalog);
    expect(match.relevant).toBe(true);
    expect(match.favoriteMatches).toHaveLength(1);
    const m = match.favoriteMatches[0];
    expect(m.kind).toBe("alternative");
    if (m.kind === "alternative") {
      expect(m.favoriteFoodId).toBe("magerquark");
      expect(m.originalFoodId).toBe("skyr");
      expect(m.alternativeType).toBe("similar");
      expect(m.autoSwap).toBe(true);
    }
    expect(match.hasDislikedConflict).toBe(false);
  });

  it("zeigt die personalisierte Variante mit 100 g Magerquark statt 100 g Skyr", () => {
    const original = recipe(slug);
    const personalized = personalizeRecipe({ servings: original.servings, ingredients: original.ingredients }, prefs(["Magerquark"]), catalog);

    expect(personalized.adapted).toBe(true);
    expect(personalized.swaps).toEqual([
      expect.objectContaining({ fromName: "Skyr", toName: "Magerquark", type: "similar", favoriteLabel: "Magerquark" }),
    ]);
    expect(personalized.ingredientLines).toContain("100 g Magerquark");
    expect(personalized.ingredientLines).not.toContain("100 g Skyr");
    // Alles andere bleibt unverändert.
    expect(personalized.ingredientLines).toContain("40 g Haferflocken");
    expect(personalized.ingredientLines).toHaveLength(original.ingredientLines.length);
  });

  it("berechnet die Nährwerte mit den neuen Zutaten neu, statt die des Originals zu behalten", () => {
    const original = recipe(slug);
    const personalized = personalizeRecipe({ servings: original.servings, ingredients: original.ingredients }, prefs(["Magerquark"]), catalog);

    const delta = personalized.nutrition.perServing.kcal - personalized.originalNutrition.perServing.kcal;
    expect(delta).toBeCloseTo(4, 5); // 100 g: 67 kcal (Magerquark) statt 63 kcal (Skyr)
    expect(personalized.nutrition.perServing.proteinG).toBeGreaterThan(personalized.originalNutrition.perServing.proteinG);
    expect(personalized.originalNutrition.perServing.kcal).toBeCloseTo(original.nutrition.kcal, 0);
    expect(personalized.nutrition.complete).toBe(true);
  });

  it("wendet mehrere Lieblingsfoods gleichzeitig an (Magerquark + Haferdrink)", () => {
    const original = recipe(slug);
    const personalized = personalizeRecipe(
      { servings: original.servings, ingredients: original.ingredients },
      prefs(["Magerquark", "Haferdrink"]),
      catalog,
    );
    expect(personalized.swaps.map((s) => s.toName).sort()).toEqual(["Haferdrink", "Magerquark"]);
    expect(personalized.ingredientLines).toContain("100 g Magerquark");
    expect(personalized.ingredientLines).toContain("50 ml Haferdrink");
    // Magerquark ist selbst ein Milchprodukt, das Allergen bleibt also bestehen.
    expect(personalized.allergens).toContain("milch");
  });

  it("entfernt ein Allergen nur, wenn wirklich alle Quellen ersetzt sind (Sojajoghurt + Haferdrink)", () => {
    const original = recipe(slug);
    const personalized = personalizeRecipe(
      { servings: original.servings, ingredients: original.ingredients },
      prefs(["Sojajoghurt", "Haferdrink"]),
      catalog,
    );
    expect(personalized.allergens).not.toContain("milch");
    expect(personalized.allergens).toEqual(expect.arrayContaining(["soja", "ei", "gluten"]));
  });

  it("aktualisiert Allergene aus den gewählten Foods (Sojajoghurt statt Skyr)", () => {
    const yogurtBowl = recipe("protein-yogurt-bowl");
    const personalized = personalizeRecipe(
      { servings: yogurtBowl.servings, ingredients: yogurtBowl.ingredients },
      prefs(["Sojajoghurt"]),
      catalog,
    );
    expect(personalized.adapted).toBe(true);
    expect(personalized.allergens).toEqual(expect.arrayContaining(["soja", "gluten"]));
    expect(personalized.allergens).not.toContain("milch");
  });
});

describe("Fall 2: direkter Treffer (Hähnchen -> Chicken Teriyaki Rice Bowl)", () => {
  it("erkennt 'Hähnchen' über den Alias als Hähnchenbrust im Rezept, ohne etwas zu ersetzen", () => {
    const slug = "chicken-teriyaki-rice-bowl";
    const match = matchRecipeToPreferences(matchable(slug), prefs(["Hähnchen"]), catalog);
    expect(match.relevant).toBe(true);
    expect(match.favoriteMatches).toEqual([
      expect.objectContaining({ kind: "direct", foodId: "haehnchenbrust", label: "Hähnchen" }),
    ]);
    expect(match.favoriteScore).toBe(1);

    const r = recipe(slug);
    const personalized = personalizeRecipe({ servings: r.servings, ingredients: r.ingredients }, prefs(["Hähnchen"]), catalog);
    expect(personalized.adapted).toBe(false);
    expect(personalized.ingredientLines).toEqual(r.ingredientLines);
  });

  it("wertet ein direkt vorhandenes Lieblingsfood höher als eine Alternative", () => {
    const direct = matchRecipeToPreferences(matchable("protein-pancakes-with-berries"), prefs(["Skyr"]), catalog);
    const alternative = matchRecipeToPreferences(matchable("protein-pancakes-with-berries"), prefs(["Magerquark"]), catalog);
    expect(direct.favoriteScore).toBeGreaterThan(alternative.favoriteScore);
  });

  it("zählt ein Lieblingsfood nur einmal, auch wenn es mehrfach vorkommt", () => {
    const match = matchRecipeToPreferences(matchable("chicken-fajitas"), prefs(["Paprika", "Hähnchen"]), catalog);
    expect(match.favoriteMatches).toHaveLength(2);
  });
});

describe("Fall 3: ungeliebtes Lebensmittel (Paprika -> Chicken Fajitas)", () => {
  it("erkennt den Konflikt und macht ihn für spätere Empfehlungen sichtbar", () => {
    const match = matchRecipeToPreferences(matchable("chicken-fajitas"), prefs([], ["Paprika"]), catalog);
    expect(match.hasDislikedConflict).toBe(true);
    expect(match.dislikeConflicts).toEqual([
      expect.objectContaining({ label: "Paprika", foodId: "paprika", optional: false }),
    ]);
    expect(match.relevant).toBe(false);
  });

  it("findet Konflikte über Aliase ('Pilze' = Champignons) und meldet keinen ohne Treffer", () => {
    expect(matchRecipeToPreferences(matchable("keto-omelette"), prefs([], ["Pilze"]), catalog).hasDislikedConflict).toBe(true);
    expect(matchRecipeToPreferences(matchable("protein-yogurt-bowl"), prefs([], ["Paprika", "Pilze"]), catalog).hasDislikedConflict).toBe(false);
  });

  it("nennt definierte Alternativen der ungeliebten Zutat (Grundlage für spätere Ersetzung)", () => {
    const match = matchRecipeToPreferences(matchable("protein-pancakes-with-berries"), prefs([], ["Skyr"]), catalog);
    const conflict = match.dislikeConflicts[0];
    expect(conflict.foodId).toBe("skyr");
    expect(conflict.replacements.map((r) => r.foodId)).toEqual(expect.arrayContaining(["magerquark", "griechischer-joghurt"]));
  });

  it("schlägt keine Alternative vor, die der Nutzer ebenfalls nicht mag", () => {
    const match = matchRecipeToPreferences(matchable("protein-pancakes-with-berries"), prefs([], ["Skyr", "Magerquark"]), catalog);
    const conflict = match.dislikeConflicts.find((c) => c.foodId === "skyr")!;
    expect(conflict.replacements.map((r) => r.foodId)).not.toContain("magerquark");
  });
});

describe("Sicherheitsgrenzen der Personalisierung", () => {
  it("ersetzt NIE über kontextabhängige Kanten (Hähnchen -> Tofu), meldet sie aber als Möglichkeit", () => {
    const slug = "chicken-teriyaki-rice-bowl";
    const match = matchRecipeToPreferences(matchable(slug), prefs(["Tofu"]), catalog);
    expect(match.relevant).toBe(true);
    const m = match.favoriteMatches[0];
    expect(m.kind === "alternative" && m.autoSwap).toBe(false);

    const r = recipe(slug);
    expect(personalizeRecipe({ servings: r.servings, ingredients: r.ingredients }, prefs(["Tofu"]), catalog).adapted).toBe(false);
  });

  it("ersetzt Avocado nicht automatisch durch Hummus", () => {
    const r = recipe("avocado-egg-toast");
    const personalized = personalizeRecipe({ servings: r.servings, ingredients: r.ingredients }, prefs(["Hummus"]), catalog);
    expect(personalized.adapted).toBe(false);
  });

  it("ersetzt nichts durch ein Food, das der Nutzer gleichzeitig ablehnt", () => {
    const r = recipe("protein-pancakes-with-berries");
    const personalized = personalizeRecipe(
      { servings: r.servings, ingredients: r.ingredients },
      resolvePreferences({ favoriteFoods: ["Magerquark"], dislikedFoods: ["Magerquark"] }, catalog),
      catalog,
    );
    expect(personalized.adapted).toBe(false);
  });

  it("lässt ein Lieblingsfood, das schon im Rezept steckt, unangetastet", () => {
    const r = recipe("protein-pancakes-with-berries");
    const personalized = personalizeRecipe({ servings: r.servings, ingredients: r.ingredients }, prefs(["Skyr", "Magerquark"]), catalog);
    expect(personalized.adapted).toBe(false);
    expect(personalized.ingredientLines).toContain("100 g Skyr");
  });

  it("ist nicht relevant, wenn Lieblingsfood weder enthalten noch Alternative ist", () => {
    const match = matchRecipeToPreferences(matchable("chicken-fajitas"), prefs(["Magerquark"]), catalog);
    expect(match.relevant).toBe(false);
    expect(match.favoriteScore).toBe(0);
  });

  it("erkennt eine reine Alternative ohne automatische Ersetzung als schwächer", () => {
    const safe = matchRecipeToPreferences(matchable("protein-pancakes-with-berries"), prefs(["Magerquark"]), catalog);
    const contextual = matchRecipeToPreferences(matchable("chicken-teriyaki-rice-bowl"), prefs(["Tofu"]), catalog);
    expect(safe.favoriteScore).toBeGreaterThan(contextual.favoriteScore);
  });
});

describe("Rückfall auf Textabgleich (Altrezepte, unbekannte Labels)", () => {
  it("gleicht Rezepte ohne strukturierte Zutaten wie bisher per Freitext ab", () => {
    const legacy = { ingredients: [], ingredientLines: ["200 g Hüttenkäse", "1 EL Honig"] };
    expect(matchRecipeToPreferences(legacy, prefs(["Hüttenkäse"]), catalog).relevant).toBe(true);
    expect(matchRecipeToPreferences(legacy, prefs(["Mandeln"]), catalog).relevant).toBe(false);
    expect(matchRecipeToPreferences(legacy, prefs([], ["honig"]), catalog).hasDislikedConflict).toBe(true);
  });

  it("gleicht ein unbekanntes Label (kein kuratiertes Food) per Teilstring auf die Zutatennamen ab", () => {
    expect(catalog.resolveLabel("Kidney")).toEqual([]);
    const match = matchRecipeToPreferences(matchable("turkey-chili"), prefs(["Kidney"]), catalog);
    expect(match.favoriteMatches).toEqual([expect.objectContaining({ kind: "text", label: "Kidney" })]);
    expect(match.relevant).toBe(true);

    const legacy = { ingredients: [], ingredientLines: ["1 EL Ingwer, gerieben"] };
    expect(matchRecipeToPreferences(legacy, prefs(["Ingwer"]), catalog).relevant).toBe(true);
  });

  it("ignoriert leere Labels", () => {
    const resolved = resolvePreferences({ favoriteFoods: ["", "  "], dislikedFoods: [""] }, catalog);
    expect(resolved.favorites).toEqual([]);
    expect(resolved.dislikes).toEqual([]);
  });
});
