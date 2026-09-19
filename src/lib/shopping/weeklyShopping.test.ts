import { describe, expect, it } from "vitest";
import type { MealForAggregation } from "../mealPrep/aggregation";
import type { PantryItemForMatch } from "../mealPrep/enrichment";
import { calculateWeeklyShopping, computeMissingQuantity } from "./weeklyShopping";

let mealCounter = 0;
function meal(ingredients: string[], overrides: Partial<MealForAggregation> = {}): MealForAggregation {
  mealCounter += 1;
  return {
    id: `meal-${mealCounter}`,
    date: new Date(2026, 8, 21),
    slot: "LUNCH",
    recipeId: `recipe-${mealCounter}`,
    recipeName: `Rezept ${mealCounter}`,
    ingredients,
    portionMultiplier: 1,
    ...overrides,
  };
}

function pantry(id: string, name: string, remainingQuantity: number, unit: PantryItemForMatch["unit"]): PantryItemForMatch {
  return { id, name, remainingQuantity, unit };
}

function only(result: ReturnType<typeof calculateWeeklyShopping>) {
  expect(result.items).toHaveLength(1);
  return result.items[0];
}

describe("computeMissingQuantity", () => {
  it("ist die Differenz, wenn weniger vorhanden als benötigt", () => {
    expect(computeMissingQuantity(8, 3)).toBe(5);
  });

  it("ist 0, nie negativ, wenn mehr vorhanden als benötigt", () => {
    expect(computeMissingQuantity(500, 700)).toBe(0);
    expect(computeMissingQuantity(8, 10)).toBe(0);
  });

  it("rundet Fließkomma-Reste weg", () => {
    expect(computeMissingQuantity(0.3, 0.1 + 0.2)).toBe(0);
    expect(computeMissingQuantity(0.5, 0.2)).toBe(0.3);
  });
});

describe("calculateWeeklyShopping: benötigt, vorhanden, fehlt", () => {
  it("A: nichts vorhanden, alles fehlt", () => {
    const item = only(calculateWeeklyShopping([meal(["8 Stück Tomaten"])], []));
    expect(item).toMatchObject({ requiredQuantity: 8, availableQuantity: 0, missingQuantity: 8, unit: "PIECE", urgency: null });
  });

  it("B: teilweise vorhanden, die Differenz fehlt", () => {
    const item = only(calculateWeeklyShopping([meal(["8 Stück Tomaten"])], [pantry("p1", "Tomaten", 3, "PIECE")]));
    expect(item).toMatchObject({ requiredQuantity: 8, availableQuantity: 3, missingQuantity: 5 });
  });

  it("C: mehr als genug vorhanden, es fehlt 0 (nie negativ)", () => {
    const item = only(calculateWeeklyShopping([meal(["8 Stück Tomaten"])], [pantry("p1", "Tomaten", 10, "PIECE")]));
    expect(item).toMatchObject({ requiredQuantity: 8, availableQuantity: 10, missingQuantity: 0 });
  });

  it("D: mehrere Rezepte, dieselbe Zutat: erst über die Woche summieren, dann den Vorrat abziehen", () => {
    const meals = [
      meal(["4 Stück Tomaten"], { date: new Date(2026, 8, 21), recipeName: "Montagsgericht" }),
      meal(["2 Stück Tomaten"], { date: new Date(2026, 8, 23), recipeName: "Mittwochsgericht" }),
      meal(["2 Stück Tomaten"], { date: new Date(2026, 8, 25), recipeName: "Freitagsgericht" }),
    ];
    const item = only(calculateWeeklyShopping(meals, [pantry("p1", "Tomaten", 5, "PIECE")]));

    expect(item.requiredQuantity).toBe(8);
    expect(item.availableQuantity).toBe(5);
    // Einmal vom Gesamtbedarf abgezogen (8 - 5 = 3). Würde der Vorrat je Mahlzeit abgezogen, käme 0 heraus.
    expect(item.missingQuantity).toBe(3);
    expect(item.recipeCount).toBe(3);
    expect(item.sourceMeals.map((m) => m.recipeName)).toEqual(["Montagsgericht", "Mittwochsgericht", "Freitagsgericht"]);
  });

  it("summiert gleiche Einheiten sicher (500 g + 200 g Reis = 700 g)", () => {
    const item = only(calculateWeeklyShopping([meal(["500 g Reis"]), meal(["200 g Reis"])], []));
    expect(item).toMatchObject({ requiredQuantity: 700, unit: "G", missingQuantity: 700 });
  });

  it("500 g Reis benötigt, 700 g im Vorrat: fehlt 0 g", () => {
    const item = only(calculateWeeklyShopping([meal(["500 g Reis"])], [pantry("p1", "Reis", 700, "G")]));
    expect(item).toMatchObject({ requiredQuantity: 500, availableQuantity: 700, missingQuantity: 0 });
  });

  it("rechnet kompatible Einheiten um (kg-Vorrat für eine g-Zutat)", () => {
    const item = only(calculateWeeklyShopping([meal(["1500 g Reis"])], [pantry("p1", "Reis", 1, "KG")]));
    expect(item).toMatchObject({ availableQuantity: 1000, missingQuantity: 500 });
  });

  it("summiert mehrere Vorrats-Einträge derselben Zutat", () => {
    const item = only(
      calculateWeeklyShopping([meal(["500 g Reis"])], [pantry("p1", "Reis", 200, "G"), pantry("p2", "Reis", 150, "G")]),
    );
    expect(item).toMatchObject({ availableQuantity: 350, missingQuantity: 150 });
  });

  it("skaliert mit dem Portionsfaktor der Mahlzeit", () => {
    const item = only(calculateWeeklyShopping([meal(["200 g Reis"], { portionMultiplier: 1.5 })], []));
    expect(item.requiredQuantity).toBe(300);
  });

  it("reicht die Dringlichkeit des passenden Vorrats durch", () => {
    const item = only(
      calculateWeeklyShopping([meal(["300 g Spinat"])], [pantry("p1", "Spinat", 100, "G")], new Map([["p1", "CRITICAL" as const]])),
    );
    expect(item.urgency).toBe("CRITICAL");
  });

  it("behandelt einen Vorrats-Eintrag mit Restmenge 0 als nicht vorhanden", () => {
    const item = only(calculateWeeklyShopping([meal(["8 Stück Tomaten"])], [pantry("p1", "Tomaten", 0, "PIECE")]));
    expect(item).toMatchObject({ availableQuantity: 0, missingQuantity: 8, hasIncomparablePantryStock: false });
  });

  it("gibt bei leerem Plan ein leeres Ergebnis zurück", () => {
    expect(calculateWeeklyShopping([], [pantry("p1", "Reis", 500, "G")])).toEqual({ items: [], unresolvedIngredients: [] });
  });
});

describe("calculateWeeklyShopping: Einheiten", () => {
  it("E: g und Stück derselben Zutat bleiben getrennt, es wird nichts umgerechnet", () => {
    const result = calculateWeeklyShopping([meal(["2 Stück Ei"]), meal(["100 g Ei"])], []);

    expect(result.items).toHaveLength(2);
    const piece = result.items.find((i) => i.unit === "PIECE")!;
    const grams = result.items.find((i) => i.unit === "G")!;
    expect(piece).toMatchObject({ requiredQuantity: 2, missingQuantity: 2 });
    expect(grams).toMatchObject({ requiredQuantity: 100, missingQuantity: 100 });
    expect(piece.key).not.toBe(grams.key);
  });

  it("zieht Stück-Vorrat nicht von einem Gramm-Bedarf ab und markiert den nicht vergleichbaren Bestand", () => {
    const item = only(calculateWeeklyShopping([meal(["100 g Ei"])], [pantry("p1", "Ei", 6, "PIECE")]));
    expect(item).toMatchObject({ availableQuantity: 0, missingQuantity: 100, hasIncomparablePantryStock: true });
  });

  it("zieht Gramm-Vorrat nicht von einem Stück-Bedarf ab", () => {
    const item = only(calculateWeeklyShopping([meal(["2 Stück Ei"])], [pantry("p1", "Ei", 300, "G")]));
    expect(item).toMatchObject({ availableQuantity: 0, missingQuantity: 2, hasIncomparablePantryStock: true });
  });

  it("wendet denselben Vorrat nicht auf mehrere Einheiten derselben Zutat an", () => {
    const result = calculateWeeklyShopping([meal(["500 g Reis"]), meal(["1 Packung Reis"])], [pantry("p1", "Reis", 1, "KG")]);
    const grams = result.items.find((i) => i.unit === "G")!;
    const pack = result.items.find((i) => i.unit === "PACK")!;
    expect(grams).toMatchObject({ availableQuantity: 1000, missingQuantity: 0 });
    expect(pack).toMatchObject({ availableQuantity: 0, missingQuantity: 1, hasIncomparablePantryStock: true });
  });

  it("markiert nichts, wenn der Vorrat vergleichbar ist oder die Zutat gar nicht im Vorrat liegt", () => {
    const withStock = only(calculateWeeklyShopping([meal(["500 g Reis"])], [pantry("p1", "Reis", 1, "KG")]));
    const withoutStock = only(calculateWeeklyShopping([meal(["500 g Reis"])], [pantry("p1", "Nudeln", 1, "KG")]));
    expect(withStock.hasIncomparablePantryStock).toBe(false);
    expect(withoutStock.hasIncomparablePantryStock).toBe(false);
  });
});

describe("calculateWeeklyShopping: Zutaten, die der Parser nicht erkennt", () => {
  it("F: eine nicht erkannte Zeile wird nicht als Menge 0 behandelt, sondern als offen ausgewiesen", () => {
    const result = calculateWeeklyShopping([meal(["1 Ei", "1 EL Honig", "Salz, Pfeffer"], { recipeName: "Frühstück" })], []);

    expect(result.items).toEqual([]);
    expect(result.unresolvedIngredients.map((u) => u.raw).sort()).toEqual(["1 EL Honig", "1 Ei", "Salz, Pfeffer"].sort());
    expect(result.unresolvedIngredients.every((u) => u.recipeNames[0] === "Frühstück")).toBe(true);
  });

  it("berechnet erkannte Zeilen weiter, auch wenn andere Zeilen desselben Rezepts nicht erkannt werden", () => {
    const result = calculateWeeklyShopping(
      [meal(["200 g Hähnchenbrust", "1 TL Salz"], { recipeName: "Pfanne" })],
      [pantry("p1", "Hähnchenbrust", 50, "G")],
    );

    expect(only(result)).toMatchObject({ ingredientName: "Hähnchenbrust", requiredQuantity: 200, missingQuantity: 150 });
    expect(result.unresolvedIngredients).toEqual([{ raw: "1 TL Salz", recipeNames: ["Pfanne"], occurrences: 1 }]);
  });

  it("fasst dieselbe nicht erkannte Zeile aus mehreren Mahlzeiten zusammen und zählt sie", () => {
    const result = calculateWeeklyShopping(
      [meal(["Salz, Pfeffer"], { recipeName: "A" }), meal(["salz, pfeffer"], { recipeName: "B" }), meal(["Salz, Pfeffer"], { recipeName: "A" })],
      [],
    );
    expect(result.unresolvedIngredients).toEqual([{ raw: "Salz, Pfeffer", recipeNames: ["A", "B"], occurrences: 3 }]);
  });

  it("verrechnet eine nicht erkannte Zeile nie mit dem Vorrat", () => {
    const result = calculateWeeklyShopping([meal(["2 Eier"])], [pantry("p1", "Eier", 6, "PIECE")]);
    expect(result.items).toEqual([]);
    expect(result.unresolvedIngredients).toHaveLength(1);
  });
});

describe("calculateWeeklyShopping: Vorrat wird nur gelesen", () => {
  it("verändert weder Vorrat noch Mahlzeiten", () => {
    const stock = [pantry("p1", "Reis", 700, "G")];
    const meals = [meal(["500 g Reis"])];
    const stockBefore = JSON.stringify(stock);
    const mealsBefore = JSON.stringify(meals);

    calculateWeeklyShopping(meals, stock);

    expect(JSON.stringify(stock)).toBe(stockBefore);
    expect(JSON.stringify(meals)).toBe(mealsBefore);
  });

  it("führt keine ähnlich klingende Zutat zusammen (Hähnchenbrust ist nicht Hähnchenbrühe)", () => {
    const item = only(calculateWeeklyShopping([meal(["200 g Hähnchenbrust"])], [pantry("p1", "Hähnchenbrühe", 500, "G")]));
    expect(item).toMatchObject({ availableQuantity: 0, missingQuantity: 200, hasIncomparablePantryStock: false });
  });
});
