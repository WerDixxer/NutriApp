import { describe, expect, it } from "vitest";
import { buildSeedCatalog } from "./data/build";
import { FoodCatalog, normalizeFoodLabel } from "./catalog";
import { computeRecipeNutrition, roundNutrition } from "./nutrition";
import type { CatalogFood, StructuredIngredient } from "./types";
import { formatAmount, formatIngredientLine, ingredientGrams } from "./units";

const seed = buildSeedCatalog();

describe("normalizeFoodLabel / FoodCatalog.resolveLabel", () => {
  it("normalisiert Groß-/Kleinschreibung, Leerzeichen und Umlaute symmetrisch", () => {
    expect(normalizeFoodLabel("  Hähnchen  ")).toBe("haehnchen");
    expect(normalizeFoodLabel("Haehnchen")).toBe("haehnchen");
    expect(normalizeFoodLabel("Süßkartoffel")).toBe("suesskartoffel");
    expect(normalizeFoodLabel("Griechischer   Joghurt")).toBe("griechischer joghurt");
  });

  it("löst Name und Alias auf dasselbe Food auf: 'Hähnchen' = Hähnchenbrust", () => {
    expect(seed.resolveLabel("Hähnchen").map((f) => f.id)).toEqual(["haehnchenbrust"]);
    expect(seed.resolveLabel("hähnchenbrust").map((f) => f.id)).toEqual(["haehnchenbrust"]);
    expect(seed.resolveLabel("Haehnchen").map((f) => f.id)).toEqual(["haehnchenbrust"]);
    expect(seed.resolveLabel("Magerquark").map((f) => f.id)).toEqual(["magerquark"]);
    expect(seed.resolveLabel("Pilze").map((f) => f.id)).toEqual(["champignons"]);
    expect(seed.resolveLabel("Süßkartoffeln").map((f) => f.id)).toEqual(["suesskartoffel"]);
  });

  it("rät nicht: Teilwörter und unbekannte Labels lösen auf nichts auf", () => {
    expect(seed.resolveLabel("Hähn")).toEqual([]);
    expect(seed.resolveLabel("Ingwer")).toEqual([]);
    expect(seed.resolveLabel("")).toEqual([]);
  });

  it("liefert Alternativen gerichtet", () => {
    expect(seed.edge("skyr", "magerquark")).toBeDefined();
    expect(seed.edge("skyr", "banane")).toBeUndefined();
    expect(seed.alternativesFor("skyr").map((e) => e.toId)).toEqual(
      expect.arrayContaining(["magerquark", "griechischer-joghurt", "naturjoghurt", "laktosefreier-skyr"]),
    );
    expect(seed.alternativesFor("banane")).toEqual([]);
  });
});

describe("ingredientGrams", () => {
  it("rechnet g, ml (mit Dichte), Stück, Scheibe, Dose, TL um", () => {
    const skyr = seed.get("skyr")!;
    expect(ingredientGrams({ amount: 100, unit: "g" }, skyr)).toBe(100);
    expect(ingredientGrams({ amount: 100, unit: "ml" }, seed.get("milch")!)).toBeCloseTo(103);
    expect(ingredientGrams({ amount: 1, unit: "ml" }, seed.get("wasser")!)).toBe(1);
    expect(ingredientGrams({ amount: 2, unit: "piece" }, seed.get("ei")!)).toBe(110);
    expect(ingredientGrams({ amount: 2, unit: "slice" }, seed.get("vollkornbrot")!)).toBe(90);
    expect(ingredientGrams({ amount: 1, unit: "can" }, seed.get("thunfisch")!)).toBe(130);
    expect(ingredientGrams({ amount: 1, unit: "tl" }, seed.get("oel")!)).toBeCloseTo(4.6);
  });

  it("liefert null statt zu raten: keine Menge, Prise, fehlende Einheiten-Grammzahl", () => {
    const skyr = seed.get("skyr")!;
    expect(ingredientGrams({ amount: null, unit: null }, skyr)).toBeNull();
    expect(ingredientGrams({ amount: 1, unit: "pinch" }, seed.get("salz")!)).toBeNull();
    expect(ingredientGrams({ amount: 1, unit: "piece" }, skyr)).toBeNull();
  });

  it("nutzt gramsOverride als Gesamtgewicht der Menge (große Tortilla)", () => {
    expect(ingredientGrams({ amount: 1, unit: "piece", gramsOverride: 80 }, seed.get("tortilla")!)).toBe(80);
  });
});

describe("formatIngredientLine / formatAmount", () => {
  const base = { optional: false as const };
  it("formatiert Mengen wie in den bestehenden Rezepten", () => {
    expect(formatIngredientLine({ ...base, amount: 100, unit: "g", displayName: "Skyr" })).toBe("100 g Skyr");
    expect(formatIngredientLine({ ...base, amount: 1, unit: "piece", displayName: "Ei" })).toBe("1 Ei");
    expect(formatIngredientLine({ ...base, amount: 2, unit: "slice", displayName: "Vollkornbrot" })).toBe("2 Scheiben Vollkornbrot");
    expect(formatIngredientLine({ ...base, amount: 1, unit: "slice", displayName: "Toast" })).toBe("1 Scheibe Toast");
    expect(formatIngredientLine({ ...base, amount: 0.5, unit: "tl", displayName: "Backpulver" })).toBe("1/2 TL Backpulver");
    expect(formatIngredientLine({ ...base, amount: 1, unit: "can", displayName: "Thunfisch" })).toBe("1 Dose Thunfisch");
    expect(formatIngredientLine({ ...base, amount: 75, unit: "g", displayName: "Reis", note: "ungekocht" })).toBe("75 g Reis (ungekocht)");
    expect(formatIngredientLine({ ...base, amount: null, unit: null, displayName: "Salz" })).toBe("Salz");
    expect(formatIngredientLine({ ...base, optional: true, amount: null, unit: null, displayName: "Süße" })).toBe("Süße (optional)");
  });

  it("nutzt Brüche nur unter 1, sonst Dezimalkomma", () => {
    expect(formatAmount(0.25)).toBe("1/4");
    expect(formatAmount(0.75)).toBe("3/4");
    expect(formatAmount(1.5)).toBe("1,5");
    expect(formatAmount(200)).toBe("200");
  });
});

describe("computeRecipeNutrition", () => {
  const mini = new FoodCatalog(
    [
      food("a", { kcal: 100, proteinG: 10, carbsG: 20, fatG: 5, fiberG: 2, sugarG: 4, saturatedFatG: 1, sodiumMg: 100 }, { unitGrams: { piece: 50 } }),
      food("b", { kcal: 200, proteinG: 0, carbsG: 0, fatG: 22, fiberG: 0, sugarG: 0, saturatedFatG: 3, sodiumMg: 0 }),
      { ...food("salt", null), negligible: true },
      food("nonutri", null),
    ],
    [],
  );
  const ing = (foodId: string, amount: number | null, unit: StructuredIngredient["unit"], extra: Partial<StructuredIngredient> = {}): StructuredIngredient => ({
    foodId,
    displayName: foodId,
    amount,
    unit,
    optional: false,
    ...extra,
  });

  it("summiert Nährwerte je 100 g anteilig und teilt durch die Portionen", () => {
    const one = computeRecipeNutrition([ing("a", 200, "g"), ing("b", 10, "g")], 1, mini);
    expect(one.perServing.kcal).toBeCloseTo(220);
    expect(one.perServing.proteinG).toBeCloseTo(20);
    expect(one.perServing.fatG).toBeCloseTo(12.2); // 200 g * 5 % + 10 g * 22 %
    expect(one.complete).toBe(true);

    const two = computeRecipeNutrition([ing("a", 200, "g"), ing("b", 10, "g")], 2, mini);
    expect(two.perServing.kcal).toBeCloseTo(110);
  });

  it("nutzt Einheiten-Umrechnung (Stück) und ignoriert Optionales, Gewürze und Mengenlose", () => {
    const result = computeRecipeNutrition(
      [ing("a", 2, "piece"), ing("b", 5, "g", { optional: true }), ing("salt", 1, "pinch"), ing("b", null, null, { displayName: "Öl nach Geschmack" })],
      1,
      mini,
    );
    expect(result.perServing.kcal).toBeCloseTo(100);
    expect(result.unquantified).toEqual(["Öl nach Geschmack"]);
    expect(result.complete).toBe(true);
  });

  it("meldet Unauflösbares als unvollständig, statt Nullen als Messwert auszugeben", () => {
    const result = computeRecipeNutrition(
      [ing("a", 1, "slice"), ing("nonutri", 50, "g"), ing("ghost", 50, "g")],
      1,
      mini,
    );
    expect(result.complete).toBe(false);
    expect(result.unresolved.map((u) => u.reason).sort()).toEqual(["no-nutrition", "no-unit-conversion", "unknown-food"]);
  });

  it("rechnet mit dem tatsächlich gewählten Food neu: Skyr -> Magerquark ändert die Nährwerte", () => {
    const withSkyr = computeRecipeNutrition([ing("skyr", 100, "g")], 1, seed);
    const withQuark = computeRecipeNutrition([ing("magerquark", 100, "g")], 1, seed);
    expect(withSkyr.perServing.kcal).toBeCloseTo(63);
    expect(withQuark.perServing.kcal).toBeCloseTo(67);
    expect(withQuark.perServing.proteinG).toBeGreaterThan(withSkyr.perServing.proteinG);
  });

  it("rundet für Anzeige/Speicherung: kcal ganzzahlig, Makros eine Nachkommastelle", () => {
    const rounded = roundNutrition({ kcal: 359.6, proteinG: 25.96, carbsG: 39.04, fatG: 9.44, fiberG: 8.01, sugarG: 1, saturatedFatG: 2.26, sodiumMg: 401.4 });
    expect(rounded).toEqual({ kcal: 360, proteinG: 26, carbsG: 39, fatG: 9.4, fiberG: 8, sugarG: 1, saturatedFatG: 2.3, sodiumMg: 401 });
  });
});

function food(id: string, nutrition: CatalogFood["nutrition"] | null, extra: Partial<CatalogFood> = {}): CatalogFood {
  return {
    id,
    slug: id,
    name: id,
    category: "test",
    dietClass: "vegan",
    allergens: [],
    aliases: [],
    nutrition: nutrition ?? null,
    ...extra,
  };
}
