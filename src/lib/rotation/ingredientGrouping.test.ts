import { describe, expect, it } from "vitest";
import { groupPantryItemsByIngredient } from "./ingredientGrouping";

describe("groupPantryItemsByIngredient", () => {
  it("gruppiert Items mit demselben ingredientId zusammen", () => {
    const items = [
      { id: "1", ingredientId: "ing-tomato", name: "Tomaten" },
      { id: "2", ingredientId: "ing-tomato", name: "Tomaten (2. Packung)" },
    ];
    const groups = groupPantryItemsByIngredient(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it("lässt Items ohne Verknüpfung strikt getrennt, auch bei ähnlichem Namen (keine Fuzzy-Zusammenführung)", () => {
    const items = [
      { id: "1", ingredientId: null, name: "Tomate" },
      { id: "2", ingredientId: null, name: "Tomaten" },
      { id: "3", ingredientId: null, name: "Cherrytomaten" },
    ];
    const groups = groupPantryItemsByIngredient(items);
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });

  it("mischt verknüpfte Gruppen und unverknüpfte Einzelitems korrekt", () => {
    const items = [
      { id: "1", ingredientId: "ing-rice", name: "Reis" },
      { id: "2", ingredientId: "ing-rice", name: "Reis (Rest)" },
      { id: "3", ingredientId: null, name: "Irgendwas Einmaliges" },
    ];
    const groups = groupPantryItemsByIngredient(items);
    expect(groups).toHaveLength(2);
    expect(groups.some((g) => g.length === 2)).toBe(true);
    expect(groups.some((g) => g.length === 1)).toBe(true);
  });

  it("gibt eine leere Liste für eine leere Eingabe zurück", () => {
    expect(groupPantryItemsByIngredient([])).toEqual([]);
  });
});
