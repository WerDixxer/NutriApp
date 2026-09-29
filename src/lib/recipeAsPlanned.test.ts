import { describe, expect, it } from "vitest";
import { recipeAsPlanned, recipeSnapshotOf } from "./recipeAsPlanned";
import { dbRecipeToDetail, type DbRecipeLike } from "./recipeDetail";

/** Das Rezept, wie es heute in der Datenbank steht: umbenannt, neu berechnet, neue Zutaten. */
const currentRecipe: DbRecipeLike = {
  id: "r1",
  name: "Hähnchen-Bowl (neu)",
  description: "",
  imageQuery: null,
  kcal: 620,
  proteinG: 52,
  carbsG: 60,
  fatG: 18,
  prepTimeMin: 20,
  servings: 1,
  ingredients: JSON.stringify(["150 g Hähnchen", "80 g Reis"]),
  instructions: JSON.stringify(["Neu kochen."]),
  isTrending: false,
  trendSource: null,
};

/** Was beim Planen galt: 500 kcal, 40 g Protein je Portion. */
const plannedSnapshot = { recipeName: "Hähnchen-Bowl", recipeKcal: 500, recipeProteinG: 40, recipeCarbsG: 55, recipeFatG: 14 };

describe("recipeSnapshotOf (R5E)", () => {
  it("übernimmt Name und Nährwerte je Portion unskaliert aus dem gewählten Rezept", () => {
    expect(recipeSnapshotOf({ name: "Bowl", kcal: 500, proteinG: 40, carbsG: 55, fatG: 14 })).toEqual({
      recipeName: "Bowl",
      recipeKcal: 500,
      recipeProteinG: 40,
      recipeCarbsG: 55,
      recipeFatG: 14,
    });
  });
});

describe("recipeAsPlanned (R5E)", () => {
  it("nimmt Name und Nährwerte aus dem Snapshot, alles andere (Zutaten, Zubereitung) aus dem aktuellen Rezept", () => {
    const planned = recipeAsPlanned({ ...plannedSnapshot, recipe: currentRecipe });

    expect(planned).toMatchObject({ name: "Hähnchen-Bowl", kcal: 500, proteinG: 40, carbsG: 55, fatG: 14 });
    expect(planned.ingredients).toBe(currentRecipe.ingredients);
    expect(planned.instructions).toBe(currentRecipe.instructions);
    expect(planned.id).toBe("r1");
  });

  it.each([
    ["alle Spalten NULL (Eintrag von vor R5E)", { recipeName: null, recipeKcal: null, recipeProteinG: null, recipeCarbsG: null, recipeFatG: null }],
    ["Spalten fehlen ganz", {}],
    ["unvollständiger Snapshot", { ...plannedSnapshot, recipeFatG: null }],
  ])("nutzt ohne vollständigen Snapshot das aktuelle Rezept unverändert: %s", (_label, columns) => {
    expect(recipeAsPlanned({ ...columns, recipe: currentRecipe })).toBe(currentRecipe);
  });

  it("skaliert erst bei der Anzeige: 500 kcal / 40 g Protein × 1,5 ergibt 750 kcal / 60 g, der Snapshot bleibt 500 / 40", () => {
    const entry = { ...plannedSnapshot, portionMultiplier: 1.5, recipe: currentRecipe };

    const detail = dbRecipeToDetail(recipeAsPlanned(entry), entry.portionMultiplier);

    expect(detail).toMatchObject({ name: "Hähnchen-Bowl", kcal: 750, proteinG: 60 });
    expect(entry).toMatchObject({ recipeKcal: 500, recipeProteinG: 40, portionMultiplier: 1.5 });
    // Die Zutaten kommen aus dem aktuellen Rezept und werden auf die Portion umgerechnet.
    expect(detail.ingredients[0]).toContain("Hähnchen");
  });
});
