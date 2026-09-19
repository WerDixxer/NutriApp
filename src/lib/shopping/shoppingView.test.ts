import { describe, expect, it } from "vitest";
import type { MealForAggregation } from "../mealPrep/aggregation";
import { buildShoppingView, cleanIngredientName, formatShoppingQuantity, type ShoppingPayload } from "./shoppingView";
import { calculateWeeklyShopping } from "./weeklyShopping";

function item(overrides: Partial<ShoppingPayload["items"][number]> = {}): ShoppingPayload["items"][number] {
  return {
    key: "haferflocken::G",
    ingredientName: "Haferflocken",
    unit: "G",
    requiredQuantity: 500,
    availableQuantity: 0,
    missingQuantity: 500,
    recipeCount: 1,
    hasIncomparablePantryStock: false,
    ...overrides,
  };
}

function payload(overrides: Partial<ShoppingPayload> = {}): ShoppingPayload {
  return { plannedDays: 7, items: [], unresolvedIngredients: [], ...overrides };
}

describe("formatShoppingQuantity", () => {
  it("zeigt Gramm und Milliliter ganzzahlig und ab 1000 als kg bzw. l", () => {
    expect(formatShoppingQuantity(500, "G")).toBe("500 g");
    expect(formatShoppingQuantity(104.5, "G")).toBe("105 g");
    expect(formatShoppingQuantity(1965.79, "G")).toBe("1,97 kg");
    expect(formatShoppingQuantity(2000, "G")).toBe("2 kg");
    expect(formatShoppingQuantity(250, "ML")).toBe("250 ml");
    expect(formatShoppingQuantity(1500, "ML")).toBe("1,5 l");
  });

  it("rundet beim Einkaufsbedarf auf, in der Zusatzinfo kaufmännisch", () => {
    expect(formatShoppingQuantity(104.2, "G", "buy")).toBe("105 g");
    expect(formatShoppingQuantity(104.2, "G", "info")).toBe("104 g");
    expect(formatShoppingQuantity(999.4, "G", "buy")).toBe("1 kg");
    expect(formatShoppingQuantity(1961, "G", "buy")).toBe("1,97 kg");
  });

  it("kauft Stück, Packungen und Portionen in ganzen Einheiten und beugt die Einheit", () => {
    expect(formatShoppingQuantity(1.4, "PIECE", "buy")).toBe("2 Stück");
    expect(formatShoppingQuantity(1, "PIECE", "buy")).toBe("1 Stück");
    expect(formatShoppingQuantity(2.37, "PIECE", "info")).toBe("2,4 Stück");
    expect(formatShoppingQuantity(1, "PACK", "buy")).toBe("1 Packung");
    expect(formatShoppingQuantity(2.1, "PACK", "buy")).toBe("3 Packungen");
    expect(formatShoppingQuantity(2, "PORTION")).toBe("2 Portionen");
  });

  it("rechnet Stück nie in Gewicht um", () => {
    expect(formatShoppingQuantity(3, "PIECE", "buy")).toBe("3 Stück");
    expect(formatShoppingQuantity(3, "G", "buy")).toBe("3 g");
  });

  it("versteht auch kg und l als Eingabe", () => {
    expect(formatShoppingQuantity(1.5, "KG")).toBe("1,5 kg");
    expect(formatShoppingQuantity(0.25, "L")).toBe("250 ml");
  });
});

describe("cleanIngredientName", () => {
  it("entfernt Klammerzusätze und Zubereitungshinweise", () => {
    expect(cleanIngredientName("Erdbeeren, geviertelt")).toBe("Erdbeeren");
    expect(cleanIngredientName("Feta (am Stück)")).toBe("Feta");
    expect(cleanIngredientName("Milch (oder Pflanzendrink)")).toBe("Milch");
    expect(cleanIngredientName("Haferflocken")).toBe("Haferflocken");
  });

  it("fällt auf den ursprünglichen Namen zurück, wenn nichts übrig bleibt", () => {
    expect(cleanIngredientName("(nur Klammer)")).toBe("(nur Klammer)");
  });
});

describe("buildShoppingView: Zu besorgen", () => {
  it("zeigt nur die fehlende Menge, nicht den vollen Rezeptbedarf", () => {
    const view = buildShoppingView(payload({ items: [item({ requiredQuantity: 500, availableQuantity: 200, missingQuantity: 300 })] }));
    expect(view.status).toBe("list");
    expect(view.toBuy).toEqual([
      {
        key: "haferflocken::G",
        name: "Haferflocken",
        buy: "300 g",
        pantryDetail: "Benötigt 500 g, Vorrat 200 g",
        recipesLabel: null,
        unitNote: null,
      },
    ]);
  });

  it("zeigt bei leerem Vorrat keine Vorratszeile", () => {
    const [row] = buildShoppingView(payload({ items: [item()] })).toBuy;
    expect(row.buy).toBe("500 g");
    expect(row.pantryDetail).toBeNull();
  });

  it("nennt die Rezeptanzahl nur bei mehreren Rezepten", () => {
    const view = buildShoppingView(
      payload({ items: [item({ key: "a::G", ingredientName: "A", recipeCount: 1 }), item({ key: "b::G", ingredientName: "B", recipeCount: 3 })] }),
    );
    expect(view.toBuy.find((r) => r.name === "A")?.recipesLabel).toBeNull();
    expect(view.toBuy.find((r) => r.name === "B")?.recipesLabel).toBe("für 3 Rezepte");
  });

  it("weist auf Vorrat in einer nicht vergleichbaren Einheit hin", () => {
    const [row] = buildShoppingView(payload({ items: [item({ ingredientName: "Ei", key: "ei::G", hasIncomparablePantryStock: true })] })).toBuy;
    expect(row.unitNote).toBe("Im Vorrat in anderer Einheit");
  });

  it("sortiert alphabetisch nach bereinigtem Namen (Umlaute richtig)", () => {
    const view = buildShoppingView(
      payload({
        items: [
          item({ key: "z::G", ingredientName: "Zwiebeln" }),
          item({ key: "a::G", ingredientName: "Äpfel" }),
          item({ key: "b::G", ingredientName: "Bananen" }),
        ],
      }),
    );
    expect(view.toBuy.map((r) => r.name)).toEqual(["Äpfel", "Bananen", "Zwiebeln"]);
  });

  it("zeigt Stück aufgerundet und getrennt von Gramm", () => {
    const view = buildShoppingView(
      payload({
        items: [
          item({ key: "ei::PIECE", ingredientName: "Ei", unit: "PIECE", requiredQuantity: 4.4, availableQuantity: 3, missingQuantity: 1.4 }),
          item({ key: "ei::G", ingredientName: "Ei", unit: "G", requiredQuantity: 100, missingQuantity: 100 }),
        ],
      }),
    );
    expect(view.toBuy.map((r) => r.buy).sort()).toEqual(["100 g", "2 Stück"]);
  });
});

describe("buildShoppingView: Schon vorhanden", () => {
  it("sammelt vollständig gedeckte Zutaten getrennt, mit Bedarf und Vorrat", () => {
    const view = buildShoppingView(
      payload({
        items: [
          item({ requiredQuantity: 500, availableQuantity: 700, missingQuantity: 0, ingredientName: "Reis", key: "reis::G" }),
          item({ key: "milch::ML", ingredientName: "Milch", unit: "ML", requiredQuantity: 200, missingQuantity: 200 }),
        ],
      }),
    );
    expect(view.covered).toEqual([{ key: "reis::G", name: "Reis", detail: "Benötigt 500 g, Vorrat 700 g" }]);
    expect(view.toBuy.map((r) => r.name)).toEqual(["Milch"]);
  });
});

describe("buildShoppingView: Zutaten ohne Menge", () => {
  it("führt nicht erkannte Zeilen getrennt auf, ohne Menge zu erfinden", () => {
    const view = buildShoppingView(
      payload({
        items: [item()],
        unresolvedIngredients: [
          { raw: "1 EL Honig", recipeNames: ["A"], occurrences: 1 },
          { raw: "Salz, Pfeffer", recipeNames: ["A", "B"], occurrences: 3 },
        ],
      }),
    );
    expect(view.unresolved).toEqual([
      { key: "1 EL Honig", raw: "1 EL Honig", mealsLabel: "in 1 Mahlzeit" },
      { key: "Salz, Pfeffer", raw: "Salz, Pfeffer", mealsLabel: "in 3 Mahlzeiten" },
    ]);
    expect(view.toBuy).toHaveLength(1);
  });

  it("bleibt eine Liste (kein 'Alles vorhanden'), wenn nur unaufgelöste Zutaten übrig sind", () => {
    const view = buildShoppingView(
      payload({
        items: [item({ requiredQuantity: 100, availableQuantity: 100, missingQuantity: 0 })],
        unresolvedIngredients: [{ raw: "1 Ei", recipeNames: ["A"], occurrences: 2 }],
      }),
    );
    expect(view.status).toBe("list");
    expect(view.toBuy).toEqual([]);
    expect(view.unresolved).toHaveLength(1);
  });

  it("stürzt bei fehlenden Listen nicht ab", () => {
    const broken = { plannedDays: 7 } as unknown as ShoppingPayload;
    expect(buildShoppingView(broken).status).toBe("empty");
  });
});

describe("buildShoppingView: Zustände", () => {
  it("meldet 'no-plan', wenn es keinen Plan gibt", () => {
    expect(buildShoppingView(payload({ plannedDays: 0 })).status).toBe("no-plan");
  });

  it("meldet 'empty', wenn ein Plan existiert, aber keine Zutaten vorliegen", () => {
    expect(buildShoppingView(payload({ plannedDays: 7 })).status).toBe("empty");
  });

  it("meldet 'all-covered', wenn alles im Vorrat ist und nichts offen bleibt", () => {
    const view = buildShoppingView(payload({ items: [item({ availableQuantity: 500, missingQuantity: 0 })] }));
    expect(view.status).toBe("all-covered");
    expect(view.toBuy).toEqual([]);
  });

  it("weist auf eine nur teilweise geplante Woche hin", () => {
    expect(buildShoppingView(payload({ plannedDays: 5, items: [item()] })).partialWeekNote).toBe("Berechnet für 5 von 7 Tagen mit Plan.");
    expect(buildShoppingView(payload({ plannedDays: 7, items: [item()] })).partialWeekNote).toBeNull();
  });
});

describe("Anbindung an das Ergebnis von calculateWeeklyShopping (nach JSON-Übertragung)", () => {
  const meal = (ingredients: string[], recipeName: string, id: string): MealForAggregation => ({
    id,
    date: new Date(2026, 8, 21),
    slot: "LUNCH",
    recipeId: `r-${id}`,
    recipeName,
    ingredients,
    portionMultiplier: 1,
  });

  it("zeigt Bedarf, Vorrat und Rest korrekt an und führt unaufgelöste Zeilen getrennt", () => {
    const calculation = calculateWeeklyShopping(
      [
        meal(["300 g Reis", "1 EL Honig", "200 g Feta (am Stück)"], "Bowl", "1"),
        meal(["200 g Reis", "1 EL Honig"], "Pfanne", "2"),
      ],
      [{ id: "p1", name: "Reis", remainingQuantity: 200, unit: "G" }],
    );
    // So kommt es beim Client an: Datumsfelder werden zu Strings.
    const transferred = JSON.parse(JSON.stringify({ plannedDays: 7, ...calculation })) as ShoppingPayload;

    const view = buildShoppingView(transferred);

    expect(view.status).toBe("list");
    expect(view.toBuy.map((r) => [r.name, r.buy, r.pantryDetail, r.recipesLabel])).toEqual([
      ["Feta", "200 g", null, null],
      ["Reis", "300 g", "Benötigt 500 g, Vorrat 200 g", "für 2 Rezepte"],
    ]);
    expect(view.unresolved).toEqual([{ key: "1 EL Honig", raw: "1 EL Honig", mealsLabel: "in 2 Mahlzeiten" }]);
  });

  it("liefert für einen komplett gedeckten Bedarf 'Alles vorhanden'", () => {
    const calculation = calculateWeeklyShopping(
      [meal(["300 g Reis"], "Bowl", "1")],
      [{ id: "p1", name: "Reis", remainingQuantity: 1, unit: "KG" }],
    );
    const view = buildShoppingView(JSON.parse(JSON.stringify({ plannedDays: 7, ...calculation })) as ShoppingPayload);
    expect(view.status).toBe("all-covered");
    expect(view.covered[0].detail).toBe("Benötigt 300 g, Vorrat 1 kg");
  });
});
