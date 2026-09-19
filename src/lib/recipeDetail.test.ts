import { describe, expect, it } from "vitest";
import { dbRecipeToDetail, type DbRecipeLike } from "./recipeDetail";

const recipe: DbRecipeLike = {
  id: "r1",
  name: "Protein Pancakes with Berries",
  description: "Test",
  imageQuery: null,
  kcal: 360,
  proteinG: 26,
  carbsG: 39,
  fatG: 9.4,
  prepTimeMin: 5,
  totalTimeMin: 15,
  servings: 1,
  ingredients: JSON.stringify(["40 g Haferflocken", "100 g Skyr"]),
  instructions: JSON.stringify(["Schritt"]),
  isTrending: false,
  trendSource: null,
};

describe("dbRecipeToDetail", () => {
  it("nutzt ohne Personalisierung die gespeicherten Werte und Freitext-Zutaten, Anzeige mit Gesamtzeit", () => {
    const detail = dbRecipeToDetail(recipe);
    expect(detail.ingredients).toEqual(["40 g Haferflocken", "100 g Skyr"]);
    expect(detail.kcal).toBe(360);
    expect(detail.prepTimeMin).toBe(15);
    expect(detail.personalization).toBeUndefined();
  });

  it("fällt für Altrezepte ohne totalTimeMin auf prepTimeMin zurück", () => {
    expect(dbRecipeToDetail({ ...recipe, totalTimeMin: null }).prepTimeMin).toBe(5);
    expect(dbRecipeToDetail({ ...recipe, totalTimeMin: undefined }).prepTimeMin).toBe(5);
  });

  it("zeigt die personalisierte Variante: neue Zutatenzeilen, neu berechnete Nährwerte, Hinweis auf die Anpassung", () => {
    const detail = dbRecipeToDetail(recipe, 1, {
      ingredientLines: ["40 g Haferflocken", "100 g Magerquark"],
      kcal: 364,
      proteinG: 27,
      carbsG: 39,
      fatG: 9.5,
      swaps: [{ from: "Skyr", to: "Magerquark" }],
    });
    expect(detail.ingredients).toEqual(["40 g Haferflocken", "100 g Magerquark"]);
    expect(detail.kcal).toBe(364);
    expect(detail.proteinG).toBe(27);
    expect(detail.personalization).toEqual({ swaps: [{ from: "Skyr", to: "Magerquark" }] });
  });

  it("skaliert auch die personalisierten Zutaten und Nährwerte auf die Portion", () => {
    const detail = dbRecipeToDetail(recipe, 2, {
      ingredientLines: ["100 g Magerquark"],
      kcal: 364,
      proteinG: 27,
      carbsG: 39,
      fatG: 9.5,
      swaps: [{ from: "Skyr", to: "Magerquark" }],
    });
    expect(detail.ingredients[0]).toBe("200 g Magerquark");
    expect(detail.kcal).toBe(728);
  });

  it("setzt keinen Hinweis, wenn nichts ersetzt wurde", () => {
    const detail = dbRecipeToDetail(recipe, 1, { ingredientLines: ["100 g Skyr"], kcal: 360, proteinG: 26, carbsG: 39, fatG: 9.4, swaps: [] });
    expect(detail.personalization).toBeUndefined();
  });
});
