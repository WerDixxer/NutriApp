import { describe, expect, it } from "vitest";
import { enrichAggregatedIngredients, matchCost, matchPantryContribution, type PantryItemForMatch } from "./enrichment";
import type { AggregatedIngredient } from "./types";
import type { KnownPrice } from "../budget/mealCost";

function ingredient(overrides: Partial<AggregatedIngredient> = {}): AggregatedIngredient {
  return {
    key: "hähnchenbrust::G",
    normalizedName: "hähnchenbrust",
    displayName: "Hähnchenbrust",
    unit: "G",
    totalQuantity: 750,
    recipeCount: 3,
    sourceMeals: [],
    pantry: null,
    costCents: null,
    ...overrides,
  };
}

describe("matchPantryContribution", () => {
  it("gibt null zurück, wenn kein Pantry-Item mit diesem Namen existiert", () => {
    expect(matchPantryContribution("hähnchenbrust", "G", [], new Map())).toBeNull();
  });

  it("summiert mehrere Pantry-Items derselben Zutat", () => {
    const items: PantryItemForMatch[] = [
      { id: "p1", name: "Hähnchenbrust", remainingQuantity: 200, unit: "G" },
      { id: "p2", name: "Hähnchenbrust", remainingQuantity: 100, unit: "G" },
    ];
    const result = matchPantryContribution("hähnchenbrust", "G", items, new Map());
    expect(result?.availableQuantity).toBe(300);
  });

  it("rechnet kompatible Einheiten um (kg-Bestand für eine g-Zutat)", () => {
    const items: PantryItemForMatch[] = [{ id: "p1", name: "Reis", remainingQuantity: 1, unit: "KG" }];
    const result = matchPantryContribution("reis", "G", items, new Map());
    expect(result?.availableQuantity).toBe(1000);
  });

  it("überspringt ein Pantry-Item mit inkompatibler Einheit, statt zu raten", () => {
    const items: PantryItemForMatch[] = [{ id: "p1", name: "Ei", remainingQuantity: 6, unit: "PIECE" }];
    const result = matchPantryContribution("ei", "G", items, new Map());
    expect(result).toBeNull();
  });

  it("wählt die höchste Dringlichkeit unter mehreren gematchten Items", () => {
    const items: PantryItemForMatch[] = [
      { id: "p1", name: "Spinat", remainingQuantity: 200, unit: "G" },
      { id: "p2", name: "Spinat", remainingQuantity: 100, unit: "G" },
    ];
    const urgency = new Map([
      ["p1", "MEDIUM" as const],
      ["p2", "CRITICAL" as const],
    ]);
    const result = matchPantryContribution("spinat", "G", items, urgency);
    expect(result?.urgency).toBe("CRITICAL");
  });

  it("führt NIEMALS eine fälschlich ähnliche Zutat zusammen (kein Fuzzy-Match)", () => {
    const items: PantryItemForMatch[] = [{ id: "p1", name: "Hähnchenbrühe", remainingQuantity: 500, unit: "ML" }];
    const result = matchPantryContribution("hähnchenbrust", "G", items, new Map());
    expect(result).toBeNull();
  });
});

describe("matchCost: nie ein erfundener Preis", () => {
  it("gibt null zurück, wenn kein FoodPrice-Eintrag existiert", () => {
    expect(matchCost("Hähnchenbrust", 750, "G", new Map())).toBeNull();
  });

  it("berechnet die Kosten für die Gesamtmenge, wenn ein passender Preis existiert", () => {
    const prices = new Map<string, KnownPrice>([["hähnchenbrust", { priceCents: 200, quantity: 1000, unit: "G" }]]);
    expect(matchCost("Hähnchenbrust", 750, "G", prices)).toBe(150);
  });
});

describe("enrichAggregatedIngredients", () => {
  it("reichert jede Zutat unabhängig mit Pantry- und Preisdaten an", () => {
    const ingredients = [ingredient()];
    const pantryItems: PantryItemForMatch[] = [{ id: "p1", name: "Hähnchenbrust", remainingQuantity: 300, unit: "G" }];
    const urgency = new Map([["p1", "HIGH" as const]]);
    const prices = new Map<string, KnownPrice>([["hähnchenbrust", { priceCents: 500, quantity: 1000, unit: "G" }]]);

    const result = enrichAggregatedIngredients(ingredients, pantryItems, urgency, prices);
    expect(result[0].pantry).toEqual({ availableQuantity: 300, urgency: "HIGH" });
    expect(result[0].costCents).toBe(375);
  });

  it("verändert niemals Pantry-Mengen (reine Analyse)", () => {
    const items: PantryItemForMatch[] = [{ id: "p1", name: "Hähnchenbrust", remainingQuantity: 300, unit: "G" }];
    enrichAggregatedIngredients([ingredient()], items, new Map(), new Map());
    expect(items[0].remainingQuantity).toBe(300);
  });
});
