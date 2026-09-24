import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recipeBlockedByAllergies } from "./allergens";
import { FoodCatalog } from "./catalog";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { personalizeRecipe, resolvePreferences, toPersonalizedVariant, type PersonalizeOptions } from "./personalization";
import type { StructuredIngredient } from "./types";
import { ingredientGrams } from "./units";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);
const recipe = (slug: string) => built.find((r) => r.slug === slug)!;
const withFood = (foodId: string) => built.find((r) => r.ingredients.some((i) => i.foodId === foodId))!;

const PANCAKES = "protein-pancakes-with-berries"; // 100 g Skyr, 40 g Haferflocken, 50 ml Milch, ...

function personalize(slug: string, prefs: { favorites?: string[]; dislikes?: string[]; allergies?: string[] } = {}, options: PersonalizeOptions = {}) {
  const r = recipe(slug);
  return personalizeRecipe(
    { servings: r.servings, ingredients: r.ingredients },
    resolvePreferences({ favoriteFoods: prefs.favorites ?? [], dislikedFoods: prefs.dislikes ?? [] }, catalog),
    catalog,
    { replaceDisliked: true, allergyLabels: prefs.allergies ?? [], ...options },
  );
}

/** Nährwerte je Portion, unabhängig vom Produktivcode aus Food-Werten und Menge berechnet. */
function nutritionOf(ingredients: StructuredIngredient[], servings: number) {
  const total = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
  for (const i of ingredients) {
    const food = catalog.get(i.foodId)!;
    if (i.optional || food.negligible || i.amount === null || !food.nutrition) continue;
    const grams = ingredientGrams(i, food)!;
    total.kcal += (food.nutrition.kcal * grams) / 100;
    total.proteinG += (food.nutrition.proteinG * grams) / 100;
    total.carbsG += (food.nutrition.carbsG * grams) / 100;
    total.fatG += (food.nutrition.fatG * grams) / 100;
  }
  return { kcal: total.kcal / servings, proteinG: total.proteinG / servings, carbsG: total.carbsG / servings, fatG: total.fatG / servings };
}

describe("Basis: abgelehntes Food wird durch die bestehende Alternative ersetzt", () => {
  it("Skyr wird als abgelehnt erkannt und durch Magerquark ersetzt (erste gepflegte 'similar'-Alternative)", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr"] });
    expect(p.adapted).toBe(true);
    expect(p.swaps).toEqual([
      {
        ingredientIndex: recipe(PANCAKES).ingredients.findIndex((i) => i.foodId === "skyr"),
        fromFoodId: "skyr",
        fromName: "Skyr",
        toFoodId: "magerquark",
        toName: "Magerquark",
        type: "similar",
        favoriteLabel: null,
        amount: 100,
        unit: "g",
        reason: "disliked_food",
      },
    ]);
    expect(p.ingredientLines).toContain("100 g Magerquark");
    expect(p.ingredientLines).not.toContain("100 g Skyr");
  });

  it("die Alternative existiert nur, weil sie in IngredientAlternative gepflegt ist (Skyr -> Magerquark)", () => {
    expect(catalog.edge("skyr", "magerquark")).toMatchObject({ type: "similar", requiresContext: false });
  });

  it("Abneigung wird über Aliase erkannt ('Hähnchen' meint Hähnchenbrust)", () => {
    const p = personalize("chicken-teriyaki-rice-bowl", { dislikes: ["Hähnchen"] });
    expect(p.swaps).toMatchObject([{ fromFoodId: "haehnchenbrust", toFoodId: "putenbrust", reason: "disliked_food" }]);
  });

  it("Menge und Einheit bleiben gleich (kein Mengenoptimierer)", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr", "Haferflocken"] });
    for (const swap of p.swaps) {
      const original = recipe(PANCAKES).ingredients[swap.ingredientIndex];
      expect(swap.amount).toBe(original.amount);
      expect(swap.unit).toBe(original.unit);
      expect(p.ingredients[swap.ingredientIndex]).toMatchObject({ amount: original.amount, unit: original.unit });
    }
  });

  it("ohne ausdrückliche Anforderung (replaceDisliked) ändert sich nichts: bestehendes Verhalten der Planer-Ansicht", () => {
    const r = recipe(PANCAKES);
    const p = personalizeRecipe(
      { servings: r.servings, ingredients: r.ingredients },
      resolvePreferences({ favoriteFoods: [], dislikedFoods: ["Skyr"] }, catalog),
      catalog,
    );
    expect(p.adapted).toBe(false);
  });
});

describe("Keine Ersetzung", () => {
  it("abgelehntes Food ohne gepflegte Alternative: nichts wird erfunden (Paprika hat keine Kanten)", () => {
    expect(catalog.alternativesFor("paprika")).toEqual([]);
    const p = personalize("chicken-fajitas", { dislikes: ["Paprika"] });
    expect(p.adapted).toBe(false);
    expect(p.swaps).toEqual([]);
    expect(p.ingredientLines).toEqual(recipe("chicken-fajitas").ingredientLines);
    expect(toPersonalizedVariant(p)).toBeNull();
  });

  it("Zutaten, die der Nutzer nicht ablehnt, bleiben unangetastet", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr"] });
    const original = recipe(PANCAKES).ingredients;
    p.ingredients.forEach((ingredient, i) => {
      if (original[i].foodId !== "skyr") expect(ingredient).toEqual(original[i]);
    });
  });

  it("wenn alle gleichwertigen Alternativen ebenfalls abgelehnt sind, gibt es keinen Ersatz (kein Umstieg auf Sojajoghurt)", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr", "Magerquark", "Griechischer Joghurt", "Naturjoghurt"] });
    expect(p.swaps.filter((s) => s.fromFoodId === "skyr")).toEqual([]);
  });
});

describe("Mehrere gültige Alternativen: Lieblingsfood entscheidet, sonst gepflegte Reihenfolge", () => {
  it("ohne Favorit gilt die erste gepflegte Alternative (Magerquark)", () => {
    expect(personalize(PANCAKES, { dislikes: ["Skyr"] }).swaps[0].toFoodId).toBe("magerquark");
  });

  it("Lieblingsfood Griechischer Joghurt gewinnt gegen die Reihenfolge", () => {
    const swap = personalize(PANCAKES, { dislikes: ["Skyr"], favorites: ["Griechischer Joghurt"] }).swaps[0];
    expect(swap).toMatchObject({ toFoodId: "griechischer-joghurt", reason: "disliked_food", favoriteLabel: "Griechischer Joghurt" });
  });

  it("mehrere Lieblinge: der zuerst genannte zulässige gewinnt", () => {
    expect(personalize(PANCAKES, { dislikes: ["Skyr"], favorites: ["Naturjoghurt", "Griechischer Joghurt"] }).swaps[0].toFoodId).toBe("naturjoghurt");
  });

  it("ein abgelehntes Food wird nicht gewählt, auch wenn es die erste Alternative wäre", () => {
    expect(personalize(PANCAKES, { dislikes: ["Skyr", "Magerquark"] }).swaps[0].toFoodId).toBe("griechischer-joghurt");
  });

  it("ein Lieblingsfood, das im Rezept schon steckt, wird nicht ersetzt", () => {
    expect(personalize(PANCAKES, { dislikes: ["Skyr"], favorites: ["Skyr"] }).adapted).toBe(false);
  });

  it("ein Lieblingsfood einer anderen Art (Sojajoghurt) gilt als ausdrücklicher Wunsch; der Anlass bleibt die Abneigung", () => {
    const swap = personalize(PANCAKES, { dislikes: ["Skyr"], favorites: ["Sojajoghurt"] }).swaps[0];
    expect(swap).toMatchObject({ toFoodId: "sojajoghurt", reason: "disliked_food", favoriteLabel: "Sojajoghurt" });
  });
});

describe("Mehrere Ersetzungen", () => {
  it("zwei abgelehnte Zutaten werden beide ersetzt und beide erscheinen mit ihren Daten", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr", "Haferflocken"] });
    expect(p.swaps.map((s) => `${s.fromName}->${s.toName}`).sort()).toEqual(["Haferflocken->Dinkelflocken", "Skyr->Magerquark"]);
    expect(p.ingredientLines).toEqual(expect.arrayContaining(["100 g Magerquark", "40 g Dinkelflocken"]));
    expect(p.ingredientLines).toHaveLength(recipe(PANCAKES).ingredientLines.length);
  });

  it("die ursprünglichen Zutaten bleiben aus den Ersetzungen erkennbar", () => {
    const variant = toPersonalizedVariant(personalize(PANCAKES, { dislikes: ["Skyr", "Haferflocken"] }))!;
    expect(variant.replacements).toEqual(
      expect.arrayContaining([
        { fromName: "Skyr", toName: "Magerquark", quantity: "100 g", reason: "disliked_food" },
        { fromName: "Haferflocken", toName: "Dinkelflocken", quantity: "40 g", reason: "disliked_food" },
      ]),
    );
  });

  it("jede Ersetzung nennt Ausgangs- und Zielfood, Menge, Einheit und Grund", () => {
    for (const swap of personalize(PANCAKES, { dislikes: ["Skyr", "Haferflocken"] }).swaps) {
      expect(swap).toMatchObject({ fromName: expect.any(String), toName: expect.any(String), amount: expect.any(Number), unit: "g", reason: "disliked_food" });
    }
  });
});

describe("Allergien: ausschließlich die zentrale Kapitel-13-Auflösung", () => {
  const peanutRecipe = withFood("erdnussbutter");

  it("Erdnuss-Allergie: Erdnussbutter wird durch Mandelmus ersetzt, weil 'nüsse' für diese Allergie zulässig ist", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Erdnüsse"] });
    const swap = p.swaps.find((s) => s.fromFoodId === "erdnussbutter")!;
    expect(swap).toMatchObject({ toFoodId: "mandelmus", reason: "allergen", type: "similar" });
    expect(p.allergyBlocked).toEqual({ original: true, personalized: false });
  });

  it("zusätzliche Nuss-Allergie: Mandelmus und Cashewmus sind nicht zulässig, kein Ersatz, das Rezept bleibt gesperrt", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Erdnüsse", "Nüsse"] });
    expect(p.swaps.filter((s) => s.fromFoodId === "erdnussbutter")).toEqual([]);
    expect(p.adapted).toBe(false);
    expect(p.allergyBlocked).toEqual({ original: true, personalized: true });
  });

  it("die Nuss-Allergie allein reicht ebenfalls (der Oberbegriff sperrt auch Erdnuss)", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Nuss-Allergie"] });
    expect(p.swaps).toEqual([]);
    expect(p.allergyBlocked.personalized).toBe(true);
  });

  it("ein Lieblingsfood überstimmt die Allergie NICHT: Mandelmus als Favorit bei Nuss-Allergie wird nicht eingesetzt", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Erdnüsse", "Nüsse"], favorites: ["Mandelmus"] });
    expect(p.swaps).toEqual([]);
  });

  it("ein Lieblingsfood entscheidet nur unter den sicheren Alternativen (Cashewmus vor Mandelmus)", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Erdnüsse"], favorites: ["Cashewmus"] });
    expect(p.swaps.find((s) => s.fromFoodId === "erdnussbutter")).toMatchObject({ toFoodId: "cashewmus", reason: "allergen", favoriteLabel: "Cashewmus" });
  });

  it("ein Lieblingsfood, das selbst das Allergen enthält, wird nicht eingesetzt (Erdnussbutter bleibt Allergen-Zutat)", () => {
    const p = personalize(PANCAKES, { allergies: ["Milch"], favorites: ["Magerquark"] });
    expect(p.swaps.find((s) => s.fromFoodId === "skyr")?.toFoodId).not.toBe("magerquark");
  });

  it("mehrere Allergien: Milch ersetzt Skyr durch Sojajoghurt; kommt Soja hinzu, gibt es keinen sicheren Ersatz mehr", () => {
    const milkOnly = personalize(PANCAKES, { allergies: ["Milch"] });
    expect(milkOnly.swaps.find((s) => s.fromFoodId === "skyr")).toMatchObject({ toFoodId: "sojajoghurt", type: "dairy-free", reason: "allergen" });

    const milkAndSoy = personalize(PANCAKES, { allergies: ["Milch", "Soja"] });
    expect(milkAndSoy.swaps.find((s) => s.fromFoodId === "skyr")).toBeUndefined();
    expect(milkAndSoy.allergyBlocked.personalized).toBe(true);
  });

  it("'Laktose' wird wie überall als Milch aufgelöst: laktosefreie Produkte mit Milchallergen gelten konservativ als nicht sicher", () => {
    const p = personalize(PANCAKES, { allergies: ["Laktose"] });
    expect(p.swaps.find((s) => s.fromFoodId === "skyr")?.toFoodId).not.toBe("laktosefreier-skyr");
  });

  it("unbekannte Allergene bleiben konservativ: mit einem Begriff außerhalb des Vokabulars wird nichts ersetzt", () => {
    const p = personalize(peanutRecipe.slug, { allergies: ["Erdnüsse", "Sellerie"] });
    expect(p.adapted).toBe(false);
    expect(p.allergyBlocked.original).toBe(true);
    expect(p.allergyBlocked.personalized).toBe(true);

    // auch eine reine Abneigung wird dann nicht ersetzt: unbekannt gilt nie als sicher
    expect(personalize(PANCAKES, { dislikes: ["Skyr"], allergies: ["Sellerie"] }).adapted).toBe(false);
  });

  it("ohne Allergie-Angabe gibt es weder Allergie-Ersetzung noch eine Sperre", () => {
    const p = personalize(peanutRecipe.slug, {});
    expect(p.swaps).toEqual([]);
    expect(p.allergyBlocked).toEqual({ original: false, personalized: false });
  });

  it("Eigenschaft über ALLE 60 Rezepte und alle Allergene: nie ein unsicheres Ziel, nie eine Kontext-Kante, gleiche Mengen", () => {
    const labels = ["Erdnüsse", "Nüsse", "Milch", "Soja", "Gluten", "Eier", "Fisch", "Sesam", "Schalentiere"];
    let checked = 0;
    for (const r of built) {
      for (const label of labels) {
        const p = personalize(r.slug, { allergies: [label], dislikes: ["Skyr", "Haferflocken"] });
        for (const swap of p.swaps) {
          const target = catalog.get(swap.toFoodId)!;
          expect(recipeBlockedByAllergies(target.allergens, [label], [target.name]), `${r.slug}/${label}: ${swap.toName}`).toBe(false);
          expect(catalog.edge(swap.fromFoodId, swap.toFoodId)?.requiresContext, `${r.slug}: ${swap.fromName}->${swap.toName}`).toBe(false);
          const original = r.ingredients[swap.ingredientIndex];
          expect([swap.amount, swap.unit]).toEqual([original.amount, original.unit]);
          checked++;
        }
        expect(p.ingredients).toHaveLength(r.ingredients.length);
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

describe("Kontext (requiresContext)", () => {
  it("Avocado -> Hummus ist nur mit Kontext gültig und wird deshalb nie eingesetzt", () => {
    expect(catalog.edge("avocado", "hummus")?.requiresContext).toBe(true);
    const p = personalize("avocado-egg-toast", { dislikes: ["Avocado"], favorites: ["Hummus"] });
    expect(p.adapted).toBe(false);
  });

  it("Hähnchen -> Tofu/Seitan (Kontext) kommen nicht in Frage: sind Pute und Hähnchen abgelehnt, gibt es keinen Ersatz", () => {
    const p = personalize("chicken-teriyaki-rice-bowl", { dislikes: ["Hähnchen", "Putenbrust"] });
    expect(p.swaps.find((s) => s.fromFoodId === "haehnchenbrust")).toBeUndefined();
  });

  it("eine eigens gebaute Kante mit requiresContext wird ebenfalls nicht eingesetzt, dieselbe ohne Kontext schon", () => {
    const [a, b] = catalog.all();
    const foods = [
      { ...a, id: "quelle", name: "Quelle", aliases: [], allergens: [] },
      { ...b, id: "ziel", name: "Ziel", aliases: [], allergens: [] },
    ];
    const ingredient: StructuredIngredient = { foodId: "quelle", displayName: "Quelle", amount: 100, unit: "g", optional: false };
    const run = (requiresContext: boolean) =>
      personalizeRecipe(
        { servings: 1, ingredients: [ingredient] },
        resolvePreferences({ favoriteFoods: [], dislikedFoods: ["Quelle"] }, new FoodCatalog(foods, [])),
        new FoodCatalog(foods, [{ fromId: "quelle", toId: "ziel", type: "similar", requiresContext }]),
        { replaceDisliked: true },
      );
    expect(run(true).adapted).toBe(false);
    expect(run(false).adapted).toBe(true);
  });

  it("die Richtung der Alternative gilt: Magerquark -> Skyr ist eine eigene Kante, Skyr -> X ersetzt nicht rückwärts", () => {
    const p = personalize("protein-yogurt-bowl", { dislikes: ["Magerquark"] });
    for (const swap of p.swaps) expect(catalog.edge(swap.fromFoodId, swap.toFoodId)).toBeDefined();
  });
});

describe("Nährwerte werden neu berechnet", () => {
  it("kcal, Protein, Kohlenhydrate und Fett folgen dem Ersatz mit der Originalmenge (Skyr -> Magerquark, 100 g)", () => {
    const r = recipe(PANCAKES);
    const p = personalize(PANCAKES, { dislikes: ["Skyr"] });
    const skyr = catalog.get("skyr")!.nutrition!;
    const quark = catalog.get("magerquark")!.nutrition!;
    const n = p.nutrition.perServing;
    const o = p.originalNutrition.perServing;

    expect(n.kcal - o.kcal).toBeCloseTo(quark.kcal - skyr.kcal, 6);
    expect(n.proteinG - o.proteinG).toBeCloseTo(quark.proteinG - skyr.proteinG, 6);
    expect(n.carbsG - o.carbsG).toBeCloseTo(quark.carbsG - skyr.carbsG, 6);
    expect(n.fatG - o.fatG).toBeCloseTo(quark.fatG - skyr.fatG, 6);
    expect(n.kcal).not.toBe(o.kcal);
    expect(n.kcal).toBeCloseTo(nutritionOf(p.ingredients, r.servings).kcal, 6);
    expect(p.nutrition.complete).toBe(true);
  });

  it("die Menge geht ein: dieselbe Ersetzung mit 100 g wirkt doppelt so stark wie mit 50 g", () => {
    const base = recipe(PANCAKES).ingredients;
    const scaled = base.map((i) => (i.foodId === "skyr" ? { ...i, amount: 50 } : i));
    const prefs = resolvePreferences({ favoriteFoods: [], dislikedFoods: ["Skyr"] }, catalog);
    const run = (ingredients: StructuredIngredient[]) => {
      const p = personalizeRecipe({ servings: 1, ingredients }, prefs, catalog, { replaceDisliked: true });
      return p.nutrition.perServing.kcal - p.originalNutrition.perServing.kcal;
    };
    expect(run(base)).toBeCloseTo(2 * run(scaled), 6);
  });

  it("mehrere Ersetzungen werden aggregiert (Skyr + Haferflocken)", () => {
    const r = recipe(PANCAKES);
    const p = personalize(PANCAKES, { dislikes: ["Skyr", "Haferflocken"] });
    const expected = nutritionOf(p.ingredients, r.servings);
    const original = nutritionOf(r.ingredients, r.servings);
    expect(p.nutrition.perServing.kcal).toBeCloseTo(expected.kcal, 6);
    expect(p.nutrition.perServing.proteinG).toBeCloseTo(expected.proteinG, 6);
    expect(p.nutrition.perServing.carbsG).toBeCloseTo(expected.carbsG, 6);
    expect(p.nutrition.perServing.fatG).toBeCloseTo(expected.fatG, 6);
    // die Summe der beiden Einzeländerungen
    const single = (dislike: string) => {
      const q = personalize(PANCAKES, { dislikes: [dislike] });
      return q.nutrition.perServing.kcal - q.originalNutrition.perServing.kcal;
    };
    expect(p.nutrition.perServing.kcal - original.kcal).toBeCloseTo(single("Skyr") + single("Haferflocken"), 6);
  });

  it("Zutaten mit Stück-/Scheiben-Einheiten rechnen mit den Grammwerten des NEUEN Foods", () => {
    const toast = withFood("toast");
    const p = personalize(toast.slug, { dislikes: ["Toast"] });
    const swap = p.swaps.find((s) => s.fromFoodId === "toast")!;
    expect(swap.unit).toBe("slice");
    const expected = nutritionOf(p.ingredients, toast.servings);
    expect(p.nutrition.perServing.kcal).toBeCloseTo(expected.kcal, 6);
    expect(p.nutrition.perServing.kcal).not.toBeCloseTo(p.originalNutrition.perServing.kcal, 3);
  });

  it("die angezeigte Variante trägt die neu berechneten (gerundeten) Werte, nicht die des Originals", () => {
    const p = personalize(PANCAKES, { dislikes: ["Skyr"] });
    const variant = toPersonalizedVariant(p)!;
    expect(variant.kcal).toBe(Math.round(p.nutrition.perServing.kcal));
    expect(variant.proteinG).toBeCloseTo(p.nutrition.perServing.proteinG, 1);
    expect(variant.proteinG).not.toBe(Math.round(p.originalNutrition.perServing.proteinG * 10) / 10);
  });
});

describe("Original bleibt unverändert, keine Persistenz", () => {
  const deepFreeze = <T>(value: T): T => {
    if (value && typeof value === "object") {
      Object.freeze(value);
      for (const v of Object.values(value)) deepFreeze(v);
    }
    return value;
  };

  it("die Eingabe wird nie verändert (tief eingefroren) und die Variante ist eine neue Liste", () => {
    const r = recipe(PANCAKES);
    const original = JSON.parse(JSON.stringify(r.ingredients)) as StructuredIngredient[];
    const frozen = deepFreeze(JSON.parse(JSON.stringify(r.ingredients)) as StructuredIngredient[]);
    const p = personalizeRecipe(
      { servings: r.servings, ingredients: frozen },
      resolvePreferences({ favoriteFoods: [], dislikedFoods: ["Skyr", "Haferflocken"] }, catalog),
      catalog,
      { replaceDisliked: true },
    );
    expect(p.ingredients).not.toBe(frozen);
    expect(frozen).toEqual(original);
    expect(frozen.find((i) => i.foodId === "skyr")).toBeDefined();
  });

  it("die Original-Nährwerte des Ergebnisses sind die des Rezepts", () => {
    const r = recipe(PANCAKES);
    const p = personalize(PANCAKES, { dislikes: ["Skyr"] });
    expect(Math.round(p.originalNutrition.perServing.kcal)).toBe(r.nutrition.kcal);
    expect(Math.round(p.originalNutrition.perServing.proteinG * 10) / 10).toBe(r.nutrition.proteinG);
  });

  it("die Personalisierung ist rein: kein Datenbankzugriff, keine Persistenz", () => {
    const source = readFileSync("src/lib/recipes/personalization.ts", "utf8");
    expect(source).not.toMatch(/prisma|\.create\(|\.update\(|\.delete\(|\.upsert\(|localStorage/);
  });

  it("zweimal berechnet ergibt dasselbe (deterministisch, kein versteckter Zustand)", () => {
    expect(personalize(PANCAKES, { dislikes: ["Skyr"] })).toEqual(personalize(PANCAKES, { dislikes: ["Skyr"] }));
  });
});

describe("Bestehendes Verhalten der Lieblingsfood-Ersetzung bleibt erhalten", () => {
  it("Lieblingsfood Magerquark ersetzt Skyr auch ohne Abneigung, mit dem Grund favorite_food", () => {
    const r = recipe(PANCAKES);
    const p = personalizeRecipe({ servings: r.servings, ingredients: r.ingredients }, resolvePreferences({ favoriteFoods: ["Magerquark"], dislikedFoods: [] }, catalog), catalog);
    expect(p.swaps).toMatchObject([{ fromName: "Skyr", toName: "Magerquark", favoriteLabel: "Magerquark", reason: "favorite_food" }]);
  });
});
