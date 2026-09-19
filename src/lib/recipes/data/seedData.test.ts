import { describe, expect, it } from "vitest";
import { ALTERNATIVES } from "./alternatives";
import { buildRecipes, buildSeedCatalog, validateSeedData } from "./build";
import { FOODS } from "./foods";
import { RECIPES } from "./recipes";
import { TAG_NUTRITION_RULES } from "../tags";
import { DIET_CLASS_RANK } from "../types";

const catalog = buildSeedCatalog();
const recipes = buildRecipes(catalog);
const bySlug = new Map(recipes.map((r) => [r.slug, r]));

function recipe(slug: string) {
  const r = bySlug.get(slug);
  if (!r) throw new Error(`Rezept fehlt: ${slug}`);
  return r;
}

describe("Seed-Daten: Struktur", () => {
  it("enthält genau 60 Rezepte ohne strukturelle Probleme", () => {
    expect(RECIPES).toHaveLength(60);
    expect(validateSeedData()).toEqual([]);
  });

  it("hat eindeutige Rezept-Slugs und Rezeptnamen (keine Duplikate)", () => {
    expect(new Set(RECIPES.map((r) => r.slug)).size).toBe(60);
    expect(new Set(RECIPES.map((r) => r.name.toLowerCase())).size).toBe(60);
  });

  it("verweist mit jeder Zutat und jeder Alternative auf ein existierendes Food", () => {
    const slugs = new Set(FOODS.map((f) => f.slug));
    for (const r of RECIPES) for (const i of r.ingredients) expect(slugs.has(i.food), `${r.slug}: ${i.food}`).toBe(true);
    for (const a of ALTERNATIVES) {
      expect(slugs.has(a.from), a.from).toBe(true);
      expect(slugs.has(a.to), a.to).toBe(true);
    }
  });

  it("markiert alle 60 Rezepte als internal ohne Provider/externalId", () => {
    for (const r of recipes) expect(r.source).toEqual({ type: "internal", provider: null, externalId: null });
  });

  it("deckt alle geforderten Kategorien ab", () => {
    const categories = new Set(recipes.map((r) => r.category));
    for (const c of ["breakfast", "lunch", "dinner", "snack", "dessert", "pre-workout", "post-workout"]) {
      const covered = categories.has(c) || recipes.some((r) => r.tags.includes(c));
      expect(covered, c).toBe(true);
    }
  });

  it("jedes Rezept hat mindestens einen planbaren Mahlzeiten-Slot", () => {
    for (const r of recipes) expect(r.mealSlots.length, r.slug).toBeGreaterThan(0);
  });
});

describe("Seed-Daten: Foods", () => {
  it("hat pro Food konsistente Nährwerte (Energie passt zu den Makros, Atwater ±15 %)", () => {
    for (const food of FOODS) {
      if (!food.nutrition) continue;
      const n = food.nutrition;
      const expected = 4 * n.proteinG + 4 * (n.carbsG - n.fiberG) + 2 * n.fiberG + 9 * n.fatG;
      const tolerance = Math.max(0.15 * n.kcal, 12);
      expect(Math.abs(n.kcal - expected), `${food.slug}: ${n.kcal} kcal vs. ${expected.toFixed(0)} aus Makros`).toBeLessThanOrEqual(tolerance);
      expect(n.carbsG, `${food.slug}: Zucker <= Kohlenhydrate`).toBeGreaterThanOrEqual(n.sugarG);
      expect(n.fatG, `${food.slug}: ges. Fett <= Fett`).toBeGreaterThanOrEqual(n.saturatedFatG);
      expect(n.carbsG, `${food.slug}: Ballaststoffe <= Kohlenhydrate`).toBeGreaterThanOrEqual(n.fiberG);
    }
  });

  it("gibt jedem Food mit Einheit Stück/Scheibe/Dose die nötige Grammzahl", () => {
    for (const r of RECIPES) {
      for (const i of r.ingredients) {
        if (!i.unit || i.grams !== undefined) continue;
        const food = FOODS.find((f) => f.slug === i.food)!;
        if (food.negligible || i.optional) continue;
        if (["piece", "slice", "can", "tl", "el"].includes(i.unit)) {
          expect(food.unitGrams?.[i.unit as "piece"], `${r.slug}: ${i.food} braucht ${i.unit}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("Seed-Daten: Nährwerte werden aus den Zutaten berechnet", () => {
  it("kann für jedes Rezept alle Zutaten mit Menge berechnen (nichts unaufgelöst)", () => {
    for (const r of recipes) expect(r.nutritionComplete, r.slug).toBe(true);
  });

  it("liefert keine offensichtlich unrealistischen Werte", () => {
    for (const r of recipes) {
      const n = r.nutrition;
      expect(n.kcal, `${r.slug} kcal`).toBeGreaterThanOrEqual(30);
      expect(n.kcal, `${r.slug} kcal`).toBeLessThanOrEqual(800);
      expect(n.proteinG, `${r.slug} Protein`).toBeLessThanOrEqual(70);
      expect(n.fatG, `${r.slug} Fett`).toBeLessThanOrEqual(45);
      expect(n.fiberG, `${r.slug} Ballaststoffe`).toBeLessThanOrEqual(n.carbsG);
      expect(n.sugarG, `${r.slug} Zucker`).toBeLessThanOrEqual(n.carbsG);
      expect(n.saturatedFatG, `${r.slug} ges. Fett`).toBeLessThanOrEqual(n.fatG);
      const macroKcal = 4 * n.proteinG + 4 * (n.carbsG - n.fiberG) + 2 * n.fiberG + 9 * n.fatG;
      expect(Math.abs(n.kcal - macroKcal), `${r.slug}: kcal vs. Makros`).toBeLessThanOrEqual(Math.max(0.12 * n.kcal, 10));
    }
  });

  it("hat für vollwertige Mittag-/Abendessen einen sinnvollen Kalorienbereich (200 bis 800 kcal)", () => {
    for (const r of recipes) {
      if (r.mealSlots.includes("LUNCH") || r.mealSlots.includes("DINNER")) {
        expect(r.nutrition.kcal, r.slug).toBeGreaterThanOrEqual(200);
      }
    }
  });

  it("rechnet Protein Pancakes nachvollziehbar aus den Zutaten (ca. 360 kcal, 26 g Protein)", () => {
    const n = recipe("protein-pancakes-with-berries").nutrition;
    expect(n.kcal).toBeGreaterThan(340);
    expect(n.kcal).toBeLessThan(380);
    expect(n.proteinG).toBeGreaterThan(24);
    expect(n.proteinG).toBeLessThan(28);
  });
});

describe("Seed-Daten: Tags sind wahr (keine falschen Tags)", () => {
  it("erfüllt jeder nährwertbezogene Tag seine dokumentierte Schwelle", () => {
    for (const r of recipes) {
      for (const tag of r.tags) {
        const rule = TAG_NUTRITION_RULES[tag];
        if (rule) expect(rule(r.nutrition), `${r.slug}: Tag "${tag}" (${r.nutrition.kcal} kcal)`).toBe(true);
      }
    }
  });

  it("taggt Ernährungsformen nach den Zutaten: Tofu Bowl vegan, Chicken Bowl omnivore, Salmon Bowl pescatarian", () => {
    expect(recipe("vegan-peanut-tofu-bowl").dietClass).toBe("vegan");
    expect(recipe("chicken-teriyaki-rice-bowl").dietClass).toBe("omnivore");
    expect(recipe("salmon-recovery-bowl").dietClass).toBe("pescatarian");
    expect(recipe("salmon-with-potatoes-and-broccoli").dietClass).toBe("pescatarian");
  });

  it("stuft kein Rezept strenger ein, als seine Zutaten hergeben (Honig ist nicht vegan)", () => {
    for (const r of recipes) {
      const tag = r.tags.find((t) => ["omnivore", "vegetarian", "vegan", "pescatarian"].includes(t))!;
      expect(DIET_CLASS_RANK[r.dietClass], `${r.slug}: Tag ${tag}, Zutaten ${r.dietClass}`).toBeLessThanOrEqual(
        DIET_CLASS_RANK[tag as keyof typeof DIET_CLASS_RANK],
      );
    }
    // Der Auftrag taggt "Homemade Sports Drink" vegan, enthält aber Honig.
    const drink = recipe("homemade-sports-drink");
    expect(drink.dietClass).toBe("vegetarian");
    expect(drink.tags).not.toContain("vegan");
    expect(drink.dietTypes).not.toContain("VEGAN");
  });

  it("leitet dietTypes (Vokabular des bestehenden Schemas) aus den Zutaten ab", () => {
    expect(recipe("vegan-tofu-stir-fry").dietTypes).toEqual(expect.arrayContaining(["OMNIVORE", "PESCETARIAN", "VEGETARIAN", "VEGAN"]));
    expect(recipe("chicken-fajitas").dietTypes).toEqual(["OMNIVORE"]);
    expect(recipe("keto-omelette").dietTypes).toEqual(expect.arrayContaining(["VEGETARIAN", "KETO", "LOW_CARB"]));
    expect(recipe("tuna-toast").dietTypes).toEqual(expect.arrayContaining(["OMNIVORE", "PESCETARIAN"]));
    expect(recipe("tuna-toast").dietTypes).not.toContain("VEGETARIAN");
  });

  it("verknüpft quick mit realer Gesamtzeit und easy mit Schwierigkeitsgrad", () => {
    for (const r of recipes) {
      if (r.tags.includes("quick")) expect(r.totalTimeMin, r.slug).toBeLessThanOrEqual(20);
      if (r.tags.includes("easy")) expect(r.difficulty, r.slug).toBe("easy");
      expect(r.totalTimeMin, r.slug).toBe(r.prepTimeMin + r.cookTimeMin);
    }
  });
});

describe("Seed-Daten: Allergene, Meal Prep, Zutatenlisten", () => {
  it("leitet Allergene aus den Foods ab", () => {
    expect(recipe("protein-pancakes-with-berries").allergens).toEqual(expect.arrayContaining(["milch", "ei", "gluten"]));
    expect(recipe("vegan-peanut-tofu-bowl").allergens).toEqual(expect.arrayContaining(["erdnuss", "soja"]));
    expect(recipe("creamy-chicken-pasta").allergens).toEqual(expect.arrayContaining(["gluten", "milch"]));
    expect(recipe("salmon-avocado-bowl").allergens).toContain("fisch");
    expect(recipe("tofu-scramble").allergens).toContain("soja");
    expect(recipe("banana-with-honey").allergens).toEqual([]);
  });

  it("kennzeichnet Meal Prep aus dem meal-prep-Tag und erfindet keine Lagerzeiten", () => {
    for (const r of recipes) {
      expect(r.mealPrepSuitable, r.slug).toBe(r.tags.includes("meal-prep"));
      if (!r.mealPrepSuitable) {
        expect(r.storageDays, r.slug).toBeNull();
        expect(r.storage, r.slug).toBeNull();
      } else if (r.storageDays !== null) {
        expect(r.storageDays, r.slug).toBeLessThanOrEqual(4);
        expect(r.storage).toBe("FRIDGE");
      }
    }
    for (const slug of [
      "chicken-teriyaki-rice-bowl",
      "chicken-burrito-bowl",
      "vegan-chickpea-curry",
      "vegan-tofu-stir-fry",
      "beef-and-broccoli",
      "turkey-chili",
      "chicken-and-sweet-potato-bowl",
      "chicken-recovery-bowl",
      "overnight-oats-apple-cinnamon",
    ]) {
      expect(recipe(slug).mealPrepSuitable, slug).toBe(true);
    }
    // Energy Balls: meal-prep-tauglich, aber ohne verlässliche Haltbarkeitsangabe.
    expect(recipe("protein-energy-balls").storageDays).toBeNull();
  });

  it("rendert die Freitext-Zutatenzeilen wie im Auftrag (100 g Skyr, 1 Ei, 2 Scheiben Vollkornbrot)", () => {
    expect(recipe("protein-pancakes-with-berries").ingredientLines).toEqual([
      "40 g Haferflocken",
      "1 Ei",
      "100 g Skyr",
      "50 ml Milch",
      "1/2 TL Backpulver",
      "100 g Beeren",
      "Süße (optional)",
    ]);
    expect(recipe("avocado-egg-toast").ingredientLines).toEqual(["2 Scheiben Vollkornbrot", "1/2 Avocado", "2 Eier", "Salz", "Pfeffer"]);
    expect(recipe("tuna-toast").ingredientLines[1]).toBe("1 Dose Thunfisch");
  });
});

describe("Seed-Daten: Alternativen", () => {
  const has = (from: string, to: string) => ALTERNATIVES.some((a) => a.from === from && a.to === to);

  it("pflegt alle im Auftrag genannten Alternativen zentral", () => {
    const spec: [string, string[]][] = [
      ["skyr", ["magerquark", "griechischer-joghurt", "naturjoghurt", "laktosefreier-skyr"]],
      ["magerquark", ["skyr", "griechischer-joghurt", "naturjoghurt"]],
      ["griechischer-joghurt", ["skyr", "magerquark", "naturjoghurt"]],
      ["milch", ["laktosefreie-milch", "sojadrink", "haferdrink", "mandeldrink"]],
      ["frischkaese", ["frischkaese-light", "huettenkaese", "veganer-frischkaese"]],
      ["parmesan", ["hartkaese", "hefeflocken"]],
      ["halloumi", ["feta", "tofu"]],
      ["haehnchenbrust", ["putenbrust", "tofu", "seitan"]],
      ["putenbrust", ["haehnchenbrust", "tofu"]],
      ["rindfleisch", ["haehnchenbrust", "putenbrust", "tofu", "vegane-hackalternative"]],
      ["lachs", ["forelle", "fischfilet", "tofu"]],
      ["thunfisch", ["fischfilet", "kichererbsen", "haehnchenbrust"]],
      ["ei", ["tofu", "eiersatz"]],
      ["reis", ["kartoffeln", "suesskartoffel", "couscous", "bulgur", "quinoa"]],
      ["pasta", ["vollkornpasta", "dinkelpasta", "glutenfreie-pasta", "linsenpasta"]],
      ["haferflocken", ["dinkelflocken", "glutenfreie-haferflocken"]],
      ["toast", ["vollkorntoast", "vollkornbrot", "glutenfreies-brot"]],
      ["reiswaffeln", ["maiswaffeln"]],
      ["tortilla", ["vollkorn-tortilla", "glutenfreie-tortilla"]],
      ["kidneybohnen", ["schwarze-bohnen", "kichererbsen"]],
      ["kichererbsen", ["kidneybohnen", "weisse-bohnen"]],
      ["erdnussbutter", ["mandelmus", "cashewmus", "tahini"]],
      ["avocado", ["hummus"]],
      ["honig", ["ahornsirup", "agavendicksaft", "suessstoff"]],
      ["marmelade", ["marmelade-zuckerreduziert", "fruchtaufstrich"]],
    ];
    for (const [from, tos] of spec) for (const to of tos) expect(has(from, to), `${from} -> ${to}`).toBe(true);
  });

  it("kennt keine sinnlosen Alternativen (Skyr -> Banane) und pflegt Richtungen getrennt", () => {
    expect(has("skyr", "banane")).toBe(false);
    expect(has("naturjoghurt", "magerquark")).toBe(false);
    expect(catalog.edge("skyr", "magerquark")?.type).toBe("similar");
    expect(catalog.edge("skyr", "sojajoghurt")?.type).toBe("dairy-free");
  });

  it("markiert funktionsabhängige Alternativen als requiresContext (nie automatisch)", () => {
    const ctx = (from: string, to: string) => catalog.edge(from, to)?.requiresContext;
    expect(ctx("avocado", "hummus")).toBe(true);
    expect(ctx("frischkaese", "huettenkaese")).toBe(true);
    expect(ctx("haehnchenbrust", "tofu")).toBe(true);
    expect(ctx("skyr", "magerquark")).toBe(false);
    expect(ctx("haehnchenbrust", "putenbrust")).toBe(false);
  });
});
