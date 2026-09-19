import { describe, expect, it } from "vitest";
import { calculateIngredientCost, calculateTotalCost, normalizeIngredientName, type IngredientNeed, type KnownPrice } from "./mealCost";

describe("calculateIngredientCost: bekannter Preis", () => {
  it("berechnet die Kosten für dieselbe Menge/Einheit direkt", () => {
    const need: IngredientNeed = { name: "Reis", quantity: 500, unit: "G" };
    const price: KnownPrice = { priceCents: 200, quantity: 1000, unit: "G" }; // 2,00 € / kg
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBe(100);
  });

  it("rechnet kompatible Einheiten deterministisch um (kg-Preis für eine g-Menge)", () => {
    const need: IngredientNeed = { name: "Tomaten", quantity: 300, unit: "G" };
    const price: KnownPrice = { priceCents: 400, quantity: 1, unit: "KG" }; // 4,00 € / kg
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBe(120);
  });

  it("rechnet Volumeneinheiten um (l-Preis für eine ml-Menge)", () => {
    const need: IngredientNeed = { name: "Olivenöl", quantity: 30, unit: "ML" };
    const price: KnownPrice = { priceCents: 1000, quantity: 1, unit: "L" }; // 10,00 € / l
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBe(30);
  });
});

describe("calculateIngredientCost: unbekannter/unvereinbarer Preis", () => {
  it("gibt null zurück, wenn kein Preis bekannt ist, NIE 0", () => {
    const need: IngredientNeed = { name: "Safran", quantity: 1, unit: "G" };
    const result = calculateIngredientCost(need, null);
    expect(result.costCents).toBeNull();
  });

  it("gibt null zurück, wenn Bedarfseinheit und Preiseinheit nicht kompatibel sind (Stück vs. Gramm), erfindet keine Umrechnung", () => {
    const need: IngredientNeed = { name: "Gurke", quantity: 2, unit: "PIECE" };
    const price: KnownPrice = { priceCents: 150, quantity: 500, unit: "G" };
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBeNull();
  });

  it("gibt null zurück bei einer Preisangabe mit Menge 0 (Division durch 0 wird nicht zu einem Fake-Preis)", () => {
    const need: IngredientNeed = { name: "Salz", quantity: 10, unit: "G" };
    const price: KnownPrice = { priceCents: 100, quantity: 0, unit: "G" };
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBeNull();
  });

  it("gleiche Einheit ohne Umrechnung funktioniert auch für Stückzahlen", () => {
    const need: IngredientNeed = { name: "Ei", quantity: 3, unit: "PIECE" };
    const price: KnownPrice = { priceCents: 300, quantity: 6, unit: "PIECE" };
    const result = calculateIngredientCost(need, price);
    expect(result.costCents).toBe(150);
  });
});

describe("normalizeIngredientName", () => {
  it("trimmt und kleinschreibt für den Preis-Lookup", () => {
    expect(normalizeIngredientName("  Reis ")).toBe("reis");
  });
});

describe("calculateTotalCost: das Rezept-Beispiel aus der Spezifikation", () => {
  it("summiert bekannte Preise (Pasta 0,80 € + Tomaten 1,20 € + Olivenöl 0,30 € = 2,30 €)", () => {
    const needs: IngredientNeed[] = [
      { name: "Pasta", quantity: 200, unit: "G" },
      { name: "Tomaten", quantity: 300, unit: "G" },
      { name: "Olivenöl", quantity: 30, unit: "ML" },
    ];
    const prices = new Map<string, KnownPrice>([
      ["pasta", { priceCents: 80, quantity: 200, unit: "G" }],
      ["tomaten", { priceCents: 120, quantity: 300, unit: "G" }],
      ["olivenöl", { priceCents: 30, quantity: 30, unit: "ML" }],
    ]);
    const result = calculateTotalCost(needs, prices);
    expect(result.totalCostCents).toBe(230);
    expect(result.ingredientCosts).toHaveLength(3);
  });

  it("gibt 'nicht verfügbar' (null) für die Gesamtsumme zurück, sobald auch nur eine Zutat unbekannt ist", () => {
    const needs: IngredientNeed[] = [
      { name: "Pasta", quantity: 200, unit: "G" },
      { name: "Safran", quantity: 1, unit: "G" },
    ];
    const prices = new Map<string, KnownPrice>([["pasta", { priceCents: 80, quantity: 200, unit: "G" }]]);
    const result = calculateTotalCost(needs, prices);
    expect(result.totalCostCents).toBeNull();
    expect(result.ingredientCosts.find((c) => c.name === "Safran")?.costCents).toBeNull();
    expect(result.ingredientCosts.find((c) => c.name === "Pasta")?.costCents).toBe(80);
  });

  it("liefert eine leere Kostenliste für eine leere Zutatenliste, ohne Fehler", () => {
    const result = calculateTotalCost([], new Map());
    expect(result.ingredientCosts).toEqual([]);
    expect(result.totalCostCents).toBe(0);
  });
});
