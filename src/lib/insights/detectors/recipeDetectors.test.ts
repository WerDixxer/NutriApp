import { describe, expect, it } from "vitest";
import { detectRecipesMatchingAvailablePantry, type RecipeInsightCandidate } from "./recipeDetectors";
import type { PantryItemForMatch } from "../../mealPrep/enrichment";

const now = new Date("2026-09-18T12:00:00Z");

const pantry: PantryItemForMatch[] = [
  { id: "p1", name: "Hähnchenbrust", remainingQuantity: 500, unit: "G" },
  { id: "p2", name: "Reis", remainingQuantity: 500, unit: "G" },
];

function recipe(overrides: Partial<RecipeInsightCandidate> = {}): RecipeInsightCandidate {
  return {
    id: "recipe-1",
    name: "Hähnchen-Curry",
    ingredients: ["200 g Hähnchenbrust", "100 g Reis"],
    ...overrides,
  };
}

describe("detectRecipesMatchingAvailablePantry", () => {
  it("findet ein Rezept, das sich vollständig aus dem Vorrat kochen lässt", () => {
    const insights = detectRecipesMatchingAvailablePantry([recipe()], pantry, now);
    expect(insights).toHaveLength(1);
    expect(insights[0].message).toContain("Hähnchen-Curry");
    expect(insights[0].priority).toBe("useful");
  });

  it("meldet NICHTS, wenn eine Zutat fehlt", () => {
    const insights = detectRecipesMatchingAvailablePantry(
      [recipe({ ingredients: ["200 g Hähnchenbrust", "50 g Cashewkerne"] })],
      pantry,
      now,
    );
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für ein Rezept ohne eine einzige strukturiert erkennbare Zutat", () => {
    const insights = detectRecipesMatchingAvailablePantry([recipe({ ingredients: ["Salz, Pfeffer"] })], pantry, now);
    expect(insights).toHaveLength(0);
  });

  it("begrenzt die Trefferzahl auf `limit` und wählt deterministisch das Rezept mit mehr Zutaten zuerst", () => {
    const small = recipe({ id: "small", name: "Reis pur", ingredients: ["100 g Reis"] });
    const big = recipe({ id: "big", name: "Hähnchen-Curry", ingredients: ["200 g Hähnchenbrust", "100 g Reis"] });
    const insights = detectRecipesMatchingAvailablePantry([small, big], pantry, now, 1);
    expect(insights).toHaveLength(1);
    expect(insights[0].context.recipeId).toBe("big");
  });

  it("liefert bei unveränderter Eingabe dieselbe id (Dedupe-Grundlage)", () => {
    const first = detectRecipesMatchingAvailablePantry([recipe()], pantry, now);
    const second = detectRecipesMatchingAvailablePantry([recipe()], pantry, now);
    expect(first[0].id).toBe(second[0].id);
  });
});
