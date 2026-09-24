import { describe, expect, it } from "vitest";
import { checkHardConstraints } from "../agents/decision/hardConstraints";
import { searchRecipes, type SearchableRecipe } from "../agents/recipeSearch";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { conflictingLabels, createFoodPreferenceContext, isDislikedHit, isLikedHit, type PreferenceSubject } from "./foodPreferences";
import { resolvePreferences } from "./personalization";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

function subject(slug: string): PreferenceSubject {
  const recipe = built.find((r) => r.slug === slug);
  if (!recipe) throw new Error(`Seed-Rezept fehlt: ${slug}`);
  return { id: slug, ingredients: recipe.ingredientLines, structured: recipe.ingredients };
}

function context(favoriteFoods: string[], dislikedFoods: string[] = []) {
  return createFoodPreferenceContext({ favoriteFoods, dislikedFoods }, catalog);
}

/** Alle Seed-Rezepte, die das Label als Lieblingsfood (direkt/Text) bzw. als Abneigung treffen. */
function likedSlugs(label: string) {
  const ctx = context([label]);
  return built.map((r) => subject(r.slug)).filter((s) => isLikedHit(ctx.matchFor(s))).map((s) => s.id);
}
function dislikedSlugs(label: string) {
  const ctx = context([], [label]);
  return built.map((r) => subject(r.slug)).filter((s) => isDislikedHit(ctx.matchFor(s))).map((s) => s.id);
}

describe("Favorite direct: 'Hähnchen' -> Hähnchenbrust", () => {
  it("löst das Label über den Alias auf das Food auf", () => {
    const { favorites } = resolvePreferences({ favoriteFoods: ["Hähnchen"], dislikedFoods: [] }, catalog);
    expect(favorites[0].foodIds).toEqual(["haehnchenbrust"]);
  });

  it("trifft ein strukturiertes Rezept mit Hähnchenbrust direkt", () => {
    const match = context(["Hähnchen"]).matchFor(subject("chicken-fajitas"));
    expect(match.favoriteMatches).toMatchObject([{ kind: "direct", foodId: "haehnchenbrust" }]);
    expect(isLikedHit(match)).toBe(true);
  });

  it("trifft kein Rezept ohne Hähnchen", () => {
    expect(isLikedHit(context(["Hähnchen"]).matchFor(subject("protein-pancakes-with-berries")))).toBe(false);
  });
});

describe("Favorite alternative: 'Magerquark' -> Skyr-Rezept", () => {
  it("erkennt die gepflegte Alternative und markiert sie als automatisch einsetzbar", () => {
    const match = context(["Magerquark"]).matchFor(subject("protein-pancakes-with-berries"));
    expect(match.relevant).toBe(true);
    expect(match.favoriteMatches).toMatchObject([{ kind: "alternative", originalFoodId: "skyr", favoriteFoodId: "magerquark", autoSwap: true }]);
  });

  it("zählt eine bloße Alternative nicht als 'Rezept enthält das Lieblingsfood' (Planer-Bewertung bleibt unverändert)", () => {
    const match = context(["Magerquark"]).matchFor(subject("protein-pancakes-with-berries"));
    expect(isLikedHit(match)).toBe(false);
  });
});

describe("Dislike: 'Paprika' -> Chicken Fajitas", () => {
  it("meldet den Konflikt mit dem konkreten Food", () => {
    const match = context([], ["Paprika"]).matchFor(subject("chicken-fajitas"));
    expect(match.dislikeConflicts).toMatchObject([{ label: "Paprika", foodId: "paprika" }]);
    expect(isDislikedHit(match)).toBe(true);
  });

  it("kein Konflikt bei Rezepten ohne Paprika", () => {
    expect(isDislikedHit(context([], ["Paprika"]).matchFor(subject("chicken-teriyaki-rice-bowl")))).toBe(false);
  });

  it("conflictingLabels nutzt dieselbe Auflösung für ausgeschlossene Zutaten", () => {
    expect(conflictingLabels(subject("chicken-fajitas"), ["Paprika", "Fisch"], catalog)).toEqual(["Paprika"]);
    expect(conflictingLabels(subject("chicken-fajitas"), [], catalog)).toEqual([]);
  });
});

describe("Unbekannte Labels erzeugen keine Treffer", () => {
  it.each(["Trüffel", "Rosenkohl", "Algen", "Maultaschen"])("'%s' ist kein Food im Katalog und trifft keines der Katalogrezepte", (label) => {
    expect(resolvePreferences({ favoriteFoods: [label], dislikedFoods: [] }, catalog).favorites[0].foodIds).toEqual([]);
    expect(likedSlugs(label)).toEqual([]);
    expect(dislikedSlugs(label)).toEqual([]);
  });

  it("ein unbekanntes Label trifft bei Altrezepten nur, wenn der Text es wirklich enthält", () => {
    const legacy = { id: "legacy", ingredients: ["200 g Hähnchenbrust", "1 Stück Rosenkohl"] };
    expect(isDislikedHit(context([], ["Rosenkohl"]).matchFor(legacy))).toBe(true);
    expect(isDislikedHit(context([], ["Trüffel"]).matchFor(legacy))).toBe(false);
  });
});

describe("Altrezepte ohne strukturierte Zutaten: Text-Fallback", () => {
  it("ein aufgelöstes Label wird im Freitext gefunden", () => {
    const legacy = { id: "legacy", ingredients: ["200 g Hähnchenbrust", "100 g Reis"] };
    expect(isLikedHit(context(["Hähnchen"]).matchFor(legacy))).toBe(true);
    expect(isDislikedHit(context([], ["Reis"]).matchFor(legacy))).toBe(true);
  });
});

describe("Regression: Reis vs. Reiswaffel", () => {
  it("'Reis' trifft die Reiswaffel-Rezepte NICHT, weder als Liebling noch als Abneigung", () => {
    for (const slug of ["applesauce-and-rice-cakes", "rice-cake-protein-snack"]) {
      expect(likedSlugs("Reis")).not.toContain(slug);
      expect(dislikedSlugs("Reis")).not.toContain(slug);
    }
  });

  it("jedes Rezept, das 'Reis' trifft, enthält wirklich das Food Reis", () => {
    const hits = likedSlugs("Reis");
    expect(hits.length).toBeGreaterThan(0);
    for (const slug of hits) {
      expect(built.find((r) => r.slug === slug)!.ingredients.some((i) => i.foodId === "reis")).toBe(true);
    }
    expect(hits).toContain("chicken-teriyaki-rice-bowl");
  });

  it("Reiswaffeln bleiben als eigenes Food auffindbar", () => {
    expect(likedSlugs("Reiswaffeln")).toEqual(expect.arrayContaining(["applesauce-and-rice-cakes", "rice-cake-protein-snack"]));
  });
});

describe("Regression: Nudeln", () => {
  const textHits = built.filter((r) => r.ingredientLines.some((line) => line.toLowerCase().includes("nudeln"))).map((r) => r.slug);

  it("'Nudeln' ist ein Alias des Foods Pasta", () => {
    expect(resolvePreferences({ favoriteFoods: ["Nudeln"], dislikedFoods: [] }, catalog).favorites[0].foodIds).toEqual(["pasta"]);
  });

  it("findet die strukturierten Pasta-Rezepte, die der Textabgleich übersehen hat", () => {
    const hits = likedSlugs("Nudeln");
    expect(hits).toEqual(expect.arrayContaining(["creamy-chicken-pasta", "chicken-pesto-pasta"]));
    expect(hits.length).toBeGreaterThan(textHits.length);
  });

  it("verliert keinen Treffer des Textabgleichs", () => {
    const hits = likedSlugs("Nudeln");
    for (const slug of textHits) expect(hits).toContain(slug);
  });
});

describe("Frischkäse und Frischkäse light bleiben getrennte Foods", () => {
  it("'Frischkäse' trifft das Rezept mit Frischkäse light NICHT als direkten Treffer", () => {
    const match = context(["Frischkäse"]).matchFor(subject("tuna-toast"));
    expect(match.favoriteMatches).toEqual([]);
    expect(isDislikedHit(context([], ["Frischkäse"]).matchFor(subject("tuna-toast")))).toBe(false);
  });

  it("'Frischkäse light' trifft es dagegen direkt", () => {
    expect(likedSlugs("Frischkäse light")).toContain("tuna-toast");
    expect(dislikedSlugs("Frischkäse light")).toContain("tuna-toast");
  });

  it("die gepflegte Kante Frischkäse -> Frischkäse light macht 'light' als Alternative erkennbar", () => {
    const plain = { id: "plain", ingredients: ["30 g Frischkäse"], structured: [{ foodId: "frischkaese", displayName: "Frischkäse", amount: 30, unit: "g" as const, optional: false }] };
    const match = context(["Frischkäse light"]).matchFor(plain);
    expect(match.favoriteMatches).toMatchObject([{ kind: "alternative", originalFoodId: "frischkaese", favoriteFoodId: "frischkaese-light", autoSwap: true }]);
  });
});

describe("Ausgeschlossene Zutaten in Suche und Hard Constraints nutzen dieselbe Auflösung", () => {
  function searchable(slug: string): SearchableRecipe {
    const recipe = built.find((r) => r.slug === slug)!;
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

  it("Recipe Search: 'Reis' ausgeschlossen sperrt das Reisrezept, nicht die Reiswaffeln", () => {
    const candidates = ["chicken-teriyaki-rice-bowl", "rice-cake-protein-snack", "applesauce-and-rice-cakes"].map(searchable);
    const ids = searchRecipes({ excludedIngredients: ["Reis"] }, candidates, 10, catalog).map((m) => m.recipe.id);
    expect(ids.sort()).toEqual(["applesauce-and-rice-cakes", "rice-cake-protein-snack"]);
  });

  it("Recipe Search: ohne Katalog bleibt der bisherige Textabgleich", () => {
    const candidates = ["chicken-teriyaki-rice-bowl", "rice-cake-protein-snack"].map(searchable);
    const ids = searchRecipes({ excludedIngredients: ["Reis"] }, candidates, 10).map((m) => m.recipe.id);
    expect(ids).toEqual([]);
  });

  it("Hard Constraint: ausgeschlossene Zutat 'Paprika' sperrt die Fajitas", () => {
    const violations = checkHardConstraints(searchable("chicken-fajitas"), {
      allergies: [],
      dietType: "OMNIVORE",
      excludedIngredients: ["Paprika"],
      catalog,
    });
    expect(violations.map((v) => v.constraint)).toEqual(["excludedIngredients"]);
  });
});

describe("Konsistenz mit den Planer-Bausteinen", () => {
  it("die Ergebnisse sind je Rezept zwischengespeichert und stabil", () => {
    const ctx = context(["Hähnchen"], ["Paprika"]);
    const s = subject("chicken-fajitas");
    expect(ctx.matchFor(s)).toBe(ctx.matchFor(s));
  });

  it("Lieblinge und Abneigungen können dasselbe Rezept betreffen (Fajitas: Hähnchen ja, Paprika nein)", () => {
    const match = context(["Hähnchen"], ["Paprika"]).matchFor(subject("chicken-fajitas"));
    expect(isLikedHit(match)).toBe(true);
    expect(isDislikedHit(match)).toBe(true);
  });
});
