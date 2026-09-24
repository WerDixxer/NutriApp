import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { buildRecipeCatalogQualityReport } from "./catalogQuality";

/**
 * loadCatalogQualityInputs gegen einen In-Memory-Ersatz der Recipe-/RecipeIngredient-Tabellen.
 * Anders als loadCatalogRecipes (Kapitel 15) MUSS dieser Loader auch Altrezepte (ohne slug) und
 * RecipeIngredient-Zeilen mit fehlender Food-Referenz laden - genau die Fälle, die der bestehende
 * `loadStructuredIngredients` bewusst herausfiltert. Keine echte Datenbank, keine Schreiboperation.
 */
const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

function recipeRow(id: string, slug: string | null, overrides: Record<string, unknown> = {}) {
  const r = built[0];
  return {
    id,
    slug,
    name: slug ? r.name : `Altrezept ${id}`,
    servings: 1,
    tags: JSON.stringify(slug ? r.tags : []),
    ingredients: JSON.stringify(slug ? [] : ["200 g Linsen", "1 Zwiebel"]),
    createdAt: new Date(2026, 0, 1),
    ...overrides,
  };
}

const recipeFindMany = vi.fn();
const recipeIngredientFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    recipeIngredient: { findMany: (...args: unknown[]) => recipeIngredientFindMany(...args) },
  },
}));

const { loadCatalogQualityInputs } = await import("./recipeService");

beforeEach(() => vi.clearAllMocks());

describe("loadCatalogQualityInputs", () => {
  it("lädt alle Rezepte des globalen Katalogs, nicht nur die mit slug (anders als loadCatalogRecipes) - private eigene Rezepte nicht", async () => {
    recipeFindMany.mockResolvedValueOnce([recipeRow("cat-1", "protein-pancakes-with-berries"), recipeRow("legacy-1", null)]);
    recipeIngredientFindMany.mockResolvedValueOnce([]);
    const inputs = await loadCatalogQualityInputs();
    expect(inputs.map((i) => i.id).sort()).toEqual(["cat-1", "legacy-1"]);
    // Kein slug-Filter (Altrezepte bleiben drin), aber nur der globale Katalog; das Verhalten gegen
    // eine echte Datenbank prüft catalogScope.test.ts.
    expect(recipeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isCustom: false } }));
    expect(recipeIngredientFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recipe: { isCustom: false } } }));
  });

  it("lädt RecipeIngredient-Zeilen OHNE den foodId-Filter: eine fehlende Food-Referenz bleibt sichtbar", async () => {
    recipeFindMany.mockResolvedValueOnce([recipeRow("r1", "protein-pancakes-with-berries")]);
    recipeIngredientFindMany.mockResolvedValueOnce([
      { recipeId: "r1", position: 0, foodId: "skyr", displayName: "Skyr", amount: 100, unit: "g", optional: false, note: null, gramsOverride: null },
      { recipeId: "r1", position: 1, foodId: null, displayName: "Mysteriöse Zutat", amount: 40, unit: "g", optional: false, note: null, gramsOverride: null },
    ]);
    const [input] = await loadCatalogQualityInputs();
    expect(input.structuredIngredients).toHaveLength(2);
    expect(input.structuredIngredients.find((i) => i.displayName === "Mysteriöse Zutat")?.foodId).toBeNull();
  });

  it("verändert nichts: nur lesende Abfragen, kein zweiter Aufruf pro Zutat", async () => {
    recipeFindMany.mockResolvedValueOnce([recipeRow("r1", "protein-pancakes-with-berries")]);
    recipeIngredientFindMany.mockResolvedValueOnce([]);
    await loadCatalogQualityInputs();
    expect(recipeFindMany).toHaveBeenCalledTimes(1);
    expect(recipeIngredientFindMany).toHaveBeenCalledTimes(1);
  });

  it("das Ergebnis läuft fehlerfrei durch den Quality Report (Integration ohne echte DB)", async () => {
    recipeFindMany.mockResolvedValueOnce([recipeRow("r1", "protein-pancakes-with-berries"), recipeRow("legacy-1", null)]);
    recipeIngredientFindMany.mockResolvedValueOnce(
      built
        .find((r) => r.slug === "protein-pancakes-with-berries")!
        .ingredients.map((i, position) => ({
          recipeId: "r1",
          position,
          foodId: i.foodId,
          displayName: i.displayName,
          amount: i.amount,
          unit: i.unit,
          optional: i.optional,
          note: null,
          gramsOverride: i.gramsOverride ?? null,
        })),
    );
    const inputs = await loadCatalogQualityInputs();
    const report = buildRecipeCatalogQualityReport(inputs, catalog);
    expect(report.summary.totalRecipes).toBe(2);
    expect(report.summary.insufficientDataRecipes).toBe(1);
    expect(report.insufficientData[0].recipeId).toBe("legacy-1");
  });
});
