import { describe, expect, it } from "vitest";
import { aggregateIngredients, type MealForAggregation } from "./aggregation";

function meal(overrides: Partial<MealForAggregation>): MealForAggregation {
  return {
    id: "meal-1",
    date: new Date("2026-09-21"),
    slot: "LUNCH",
    recipeId: "recipe-1",
    recipeName: "Testrezept",
    ingredients: [],
    portionMultiplier: 1,
    ...overrides,
  };
}

describe("aggregateIngredients: gleiche Zutat, unterschiedliche Mengen", () => {
  it("summiert dieselbe Zutat über mehrere Mahlzeiten (gleiche Einheit)", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["200 g Hähnchenbrust"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["250 g Hähnchenbrust"] }),
      meal({ id: "m3", recipeId: "r3", ingredients: ["300 g Hähnchenbrust"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].totalQuantity).toBe(750);
    expect(aggregated[0].recipeCount).toBe(3);
  });

  it("skaliert die Menge je Mahlzeit mit dem portionMultiplier vor der Summierung", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["200 g Hähnchenbrust"], portionMultiplier: 1.5 }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["100 g Hähnchenbrust"], portionMultiplier: 2 }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated[0].totalQuantity).toBe(300 + 200);
  });
});

describe("aggregateIngredients: kompatible, aber unterschiedliche Einheiten", () => {
  it("rechnet kg in g um und summiert korrekt (Basiseinheit Gewicht = g)", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["500 g Reis"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["1 kg Reis"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].unit).toBe("G");
    expect(aggregated[0].totalQuantity).toBe(1500);
  });

  it("rechnet l in ml um (Basiseinheit Volumen = ml)", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["250 ml Milch"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["0.5 l Milch"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated[0].unit).toBe("ML");
    expect(aggregated[0].totalQuantity).toBe(750);
  });
});

describe("aggregateIngredients: inkompatible Einheiten bleiben getrennt", () => {
  it("Gewicht und Stückzahl derselben Zutat werden NICHT zusammengerechnet", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["200 g Ei"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["2 Stück Ei"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(2);
    const units = aggregated.map((a) => a.unit).sort();
    expect(units).toEqual(["G", "PIECE"]);
  });
});

describe("aggregateIngredients: fehlende Ingredient-Struktur", () => {
  it("Zeilen ohne erkennbare Struktur landen unverändert in `unparsed`, nicht in der Aggregation", () => {
    const meals = [meal({ ingredients: ["2 Salatgurken", "1 TL Salz", "200 g Hähnchenbrust"] })];
    const { aggregated, unparsed } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(1);
    expect(unparsed).toHaveLength(2);
    expect(unparsed.map((u) => u.raw)).toEqual(["2 Salatgurken", "1 TL Salz"]);
  });

  it("eine komplett unstrukturierte Rezeptliste ergibt eine leere Aggregation, keinen Fehler", () => {
    const meals = [meal({ ingredients: ["Salz, Pfeffer", "1 Prise Muskat"] })];
    const { aggregated, unparsed } = aggregateIngredients(meals);
    expect(aggregated).toEqual([]);
    expect(unparsed).toHaveLength(2);
  });
});

describe("aggregateIngredients: keine falschen Matches", () => {
  it("führt unterschiedliche Grundzutaten (Hähnchenbrust vs. Hähnchenbrühe) NICHT zusammen", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["200 g Hähnchenbrust"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["200 g Hähnchenbrühe"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(2);
  });

  it("Zubereitungshinweise nach dem Komma führen zur korrekten Zusammenführung derselben Zutat", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["100 g Karotte, geraspelt"] }),
      meal({ id: "m2", recipeId: "r2", ingredients: ["150 g Karotte, in Scheiben"] }),
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].totalQuantity).toBe(250);
  });
});

describe("aggregateIngredients: sourceMeals und recipeCount", () => {
  it("zählt recipeCount nach DISTINCT Rezepten, nicht nach Mahlzeiten (dieselbe Rezept-ID zweimal geplant)", () => {
    const meals = [
      meal({ id: "m1", recipeId: "r1", ingredients: ["200 g Reis"] }),
      meal({ id: "m2", recipeId: "r1", ingredients: ["200 g Reis"] }), // gleiches Rezept, andere Mahlzeit
    ];
    const { aggregated } = aggregateIngredients(meals);
    expect(aggregated[0].recipeCount).toBe(1);
    expect(aggregated[0].sourceMeals).toHaveLength(2);
  });

  it("liefert eine leere Aggregation für einen leeren Meal Plan", () => {
    expect(aggregateIngredients([]).aggregated).toEqual([]);
  });
});
