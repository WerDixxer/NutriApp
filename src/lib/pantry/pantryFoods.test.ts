import { describe, expect, it } from "vitest";
import { ingredientListIncludes } from "../foodMatching";
import { FoodCatalog } from "../recipes/catalog";
import { buildRecipes, buildSeedCatalog } from "../recipes/data/build";
import {
  buildPantryFoodIdsByName,
  recipeUsesPantryIngredient,
  resolvePantryFoodIds,
  resolveUniqueFood,
  type RecipeIngredientsView,
} from "./pantryFoods";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

function view(slug: string): RecipeIngredientsView {
  const recipe = built.find((r) => r.slug === slug);
  if (!recipe) throw new Error(`Seed-Rezept fehlt: ${slug}`);
  return { ingredients: recipe.ingredientLines, structured: recipe.ingredients };
}

/** Pantry-Namen -> Food-IDs, wie sie getPantryContextForHousehold für den Planer liefert. */
function idsFor(...names: string[]) {
  return buildPantryFoodIdsByName(names.map((name) => ({ name })), catalog);
}

describe("resolvePantryFoodIds: Pantry -> zentrales Food", () => {
  it.each([
    ["Paprika", "paprika"],
    ["Hähnchenbrust", "haehnchenbrust"],
    ["Hühnchen", "haehnchenbrust"], // Alias
    ["Nudeln", "pasta"], // Alias
  ])("'%s' zeigt auf das Food '%s'", (name, foodId) => {
    expect(resolvePantryFoodIds({ name }, catalog)).toEqual([foodId]);
  });

  it("ein ingredientId, das auf ein kuratiertes Food zeigt, gilt vor dem Namen", () => {
    expect(resolvePantryFoodIds({ name: "Mein Vorrat", ingredientId: "paprika" }, catalog)).toEqual(["paprika"]);
  });

  it("ein freies Ingredient (ingredientId ohne Katalogfood) fällt auf die Namensauflösung zurück, auch für Altdaten wie 'Hühnchen'", () => {
    expect(resolvePantryFoodIds({ name: "Hühnchen", ingredientId: "frei-123" }, catalog)).toEqual(["haehnchenbrust"]);
  });

  it.each(["Rosenkohl", "Blumenkohl", "Algen"])("unbekanntes '%s' bleibt eine freie Zutat ohne Food", (name) => {
    expect(resolvePantryFoodIds({ name }, catalog)).toEqual([]);
    expect(resolvePantryFoodIds({ name, ingredientId: "frei-123" }, catalog)).toEqual([]);
  });
});

describe("buildPantryFoodIdsByName", () => {
  it("enthält nur Items, die auf ein Food zeigen; freie Zutaten fehlen", () => {
    const map = idsFor("Paprika", "Rosenkohl", "Algen");
    expect([...map.keys()]).toEqual(["Paprika"]);
  });

  it("führt gleichnamige Items zusammen, ohne Food-IDs doppelt zu führen", () => {
    const map = buildPantryFoodIdsByName([{ name: "Reis" }, { name: "Reis", ingredientId: "reis" }], catalog);
    expect(map.get("Reis")).toEqual(["reis"]);
  });
});

describe("recipeUsesPantryIngredient: direkte ID-Treffer", () => {
  it("Pantry 'Paprika' trifft das Rezept mit Paprika (foodId)", () => {
    expect(recipeUsesPantryIngredient(view("chicken-fajitas"), "Paprika", idsFor("Paprika"))).toBe(true);
  });

  it("Pantry 'Hähnchenbrust' trifft das Rezept mit Hähnchenbrust (foodId)", () => {
    expect(recipeUsesPantryIngredient(view("chicken-fajitas"), "Hähnchenbrust", idsFor("Hähnchenbrust"))).toBe(true);
  });

  it("trifft kein Rezept ohne dieses Food", () => {
    expect(recipeUsesPantryIngredient(view("protein-pancakes-with-berries"), "Paprika", idsFor("Paprika"))).toBe(false);
  });
});

describe("recipeUsesPantryIngredient: Aliase über das kanonische Food", () => {
  it("Pantry 'Hühnchen' (Alias) findet das Rezept mit Hähnchenbrust, obwohl der Text 'hühnchen' nicht enthält", () => {
    const recipe = view("chicken-fajitas");
    expect(ingredientListIncludes(recipe.ingredients, "Hühnchen")).toBe(false); // der alte Textabgleich hätte es verfehlt
    expect(recipeUsesPantryIngredient(recipe, "Hühnchen", idsFor("Hühnchen"))).toBe(true);
  });

  it("Pantry 'Nudeln' (Alias von Pasta) findet die Pasta-Rezepte über die ID", () => {
    const map = idsFor("Nudeln");
    expect(recipeUsesPantryIngredient(view("creamy-chicken-pasta"), "Nudeln", map)).toBe(true);
    expect(recipeUsesPantryIngredient(view("chicken-pesto-pasta"), "Nudeln", map)).toBe(true);
  });
});

describe("recipeUsesPantryIngredient: keine falschen Substring-Treffer bei bekannten Foods", () => {
  it("'Reis' trifft Reiswaffeln NICHT (der Text-Substring täte es)", () => {
    const snack = view("rice-cake-protein-snack");
    expect(ingredientListIncludes(snack.ingredients, "Reis")).toBe(true); // alter Substring-Fehler
    expect(recipeUsesPantryIngredient(snack, "Reis", idsFor("Reis"))).toBe(false);
    expect(recipeUsesPantryIngredient(view("chicken-teriyaki-rice-bowl"), "Reis", idsFor("Reis"))).toBe(true);
  });

  it("'Reiswaffeln' bleiben als eigenes Food auffindbar", () => {
    expect(recipeUsesPantryIngredient(view("rice-cake-protein-snack"), "Reiswaffeln", idsFor("Reiswaffeln"))).toBe(true);
  });

  it("jedes Rezept, das 'Nudeln' trifft, enthält wirklich das Food Pasta, und jedes mit Pasta wird gefunden", () => {
    const map = idsFor("Nudeln");
    for (const recipe of built) {
      const hit = recipeUsesPantryIngredient({ ingredients: recipe.ingredientLines, structured: recipe.ingredients }, "Nudeln", map);
      expect(hit).toBe(recipe.ingredients.some((i) => i.foodId === "pasta"));
    }
  });

  it("ein Wort mit 'nudeln' im Rezepttext ist kein Treffer, wenn das strukturierte Food ein anderes ist", () => {
    const glutenFreePasta = catalog.resolveLabel("glutenfreie Nudeln")[0];
    expect(glutenFreePasta.id).not.toBe("pasta");
    const recipe: RecipeIngredientsView = {
      ingredients: ["200 g Glutenfreie Nudeln"],
      structured: [{ foodId: glutenFreePasta.id, displayName: "Glutenfreie Nudeln", amount: 200, unit: "g", optional: false }],
    };
    expect(ingredientListIncludes(recipe.ingredients, "Nudeln")).toBe(true); // alter Substring-Treffer
    expect(recipeUsesPantryIngredient(recipe, "Nudeln", idsFor("Nudeln"))).toBe(false);
  });
});

describe("recipeUsesPantryIngredient: Text-Fallback", () => {
  it.each(["Rosenkohl", "Blumenkohl", "Algen"])("unbekannte freie Zutat '%s' wird weiter im Text gefunden", (name) => {
    const map = idsFor(name);
    expect(map.has(name)).toBe(false);
    const withIt: RecipeIngredientsView = { ingredients: [`200 g ${name}`, "1 Zwiebel"], structured: view("chicken-fajitas").structured };
    expect(recipeUsesPantryIngredient(withIt, name, map)).toBe(true);
    expect(recipeUsesPantryIngredient(view("chicken-fajitas"), name, map)).toBe(false);
  });

  it("Altrezept ohne strukturierte Zutaten: auch ein bekanntes Food wird über den Text gefunden", () => {
    const legacy: RecipeIngredientsView = { ingredients: ["200 g Hähnchenbrust", "2 Paprika"] };
    expect(recipeUsesPantryIngredient(legacy, "Paprika", idsFor("Paprika"))).toBe(true);
    expect(recipeUsesPantryIngredient(legacy, "Zucchini", idsFor("Zucchini"))).toBe(false);
  });

  it("ohne Food-ID-Map gilt überall der bisherige Textabgleich", () => {
    expect(recipeUsesPantryIngredient(view("chicken-fajitas"), "Paprika")).toBe(true);
    expect(recipeUsesPantryIngredient(view("rice-cake-protein-snack"), "Reis")).toBe(true);
  });

  it("die ID-Logik wird nicht vom Text überschrieben: bekanntes Food + strukturiertes Rezept ohne dieses Food = kein Treffer, auch wenn der Text es nennt", () => {
    const misleading: RecipeIngredientsView = {
      ingredients: ["100 g Paprika-Gewürz"],
      structured: [{ foodId: "reis", displayName: "Paprika-Gewürz", amount: 100, unit: "g", optional: false }],
    };
    expect(recipeUsesPantryIngredient(misleading, "Paprika", idsFor("Paprika"))).toBe(false);
  });
});

describe("resolveUniqueFood: kein geratenes Food bei Mehrdeutigkeit", () => {
  const [a, b] = catalog.all();
  const ambiguous = new FoodCatalog(
    [
      { ...a, id: "food-a", name: "Alpha", aliases: ["gemeinsam"] },
      { ...b, id: "food-b", name: "Beta", aliases: ["gemeinsam", "alpha"] },
    ],
    [],
  );

  it("löst einen eindeutigen Namen oder Alias auf", () => {
    expect(resolveUniqueFood("Hühnchen", catalog)?.id).toBe("haehnchenbrust");
    expect(resolveUniqueFood("Paprika", catalog)?.id).toBe("paprika");
  });

  it("liefert null für unbekannte Begriffe", () => {
    expect(resolveUniqueFood("Rosenkohl", catalog)).toBeNull();
  });

  it("liefert null, wenn ein Alias zu mehreren Foods gehört und keines exakt so heißt", () => {
    expect(ambiguous.resolveLabel("gemeinsam")).toHaveLength(2);
    expect(resolveUniqueFood("gemeinsam", ambiguous)).toBeNull();
  });

  it("bevorzugt bei Mehrdeutigkeit das Food, das exakt so heißt", () => {
    expect(ambiguous.resolveLabel("alpha")).toHaveLength(2);
    expect(resolveUniqueFood("Alpha", ambiguous)?.id).toBe("food-a");
  });
});
