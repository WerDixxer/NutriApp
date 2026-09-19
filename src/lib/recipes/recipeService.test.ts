import { beforeEach, describe, expect, it, vi } from "vitest";

const ingredientFindMany = vi.fn();
const alternativeFindMany = vi.fn();
const recipeIngredientFindMany = vi.fn();
const profileFindUnique = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    ingredient: { findMany: (...args: unknown[]) => ingredientFindMany(...args) },
    ingredientAlternative: { findMany: (...args: unknown[]) => alternativeFindMany(...args) },
    recipeIngredient: { findMany: (...args: unknown[]) => recipeIngredientFindMany(...args) },
    profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) },
  },
}));

const { analyzeRecipesForProfile, loadFoodCatalog, loadStructuredIngredients, toPersonalizationInput } = await import("./recipeService");

function foodRow(id: string, name: string, kcal: number | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    normalizedName: name.toLowerCase(),
    slug: id,
    category: "dairy",
    dietClass: "vegetarian",
    aliases: "[]",
    allergens: '["milch"]',
    negligible: false,
    unitGrams: null,
    kcalPer100: kcal,
    proteinPer100G: kcal === null ? null : 10,
    carbsPer100G: kcal === null ? null : 4,
    fatPer100G: kcal === null ? null : 1,
    fiberPer100G: kcal === null ? null : 0,
    sugarPer100G: kcal === null ? null : 4,
    saturatedFatPer100G: kcal === null ? null : 0.5,
    sodiumPer100Mg: kcal === null ? null : 40,
    ...extra,
  };
}

function ingredientRow(recipeId: string, position: number, foodId: string, extra: Record<string, unknown> = {}) {
  return {
    id: `${recipeId}-${position}`,
    recipeId,
    position,
    foodId,
    displayName: foodId,
    amount: 100,
    unit: "g",
    optional: false,
    note: null,
    gramsOverride: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ingredientFindMany.mockResolvedValue([
    foodRow("db-skyr", "Skyr", 63),
    foodRow("db-quark", "Magerquark", 67, { aliases: '["quark"]' }),
    foodRow("db-banane", "Banane", 95, { dietClass: "vegan", allergens: "[]" }),
  ]);
  alternativeFindMany.mockResolvedValue([
    { id: "e1", fromFoodId: "db-skyr", toFoodId: "db-quark", type: "similar", requiresContext: false, note: null },
  ]);
  profileFindUnique.mockResolvedValue({ likedFoods: [{ label: "Magerquark" }], dislikedFoods: [{ label: "Banane" }] });
  recipeIngredientFindMany.mockResolvedValue([
    ingredientRow("r-skyr", 0, "db-skyr", { displayName: "Skyr" }),
    ingredientRow("r-skyr", 1, "db-banane", { displayName: "Banane", amount: 1, unit: "piece" }),
  ]);
});

describe("loadFoodCatalog", () => {
  it("baut den Katalog aus DB-Zeilen, mit DB-IDs und parsierten JSON-Feldern", async () => {
    const catalog = await loadFoodCatalog();
    expect(catalog.size).toBe(3);
    expect(catalog.resolveLabel("Quark").map((f) => f.id)).toEqual(["db-quark"]);
    expect(catalog.get("db-skyr")?.allergens).toEqual(["milch"]);
    expect(catalog.get("db-skyr")?.nutrition?.kcal).toBe(63);
    expect(catalog.edge("db-skyr", "db-quark")?.type).toBe("similar");
    expect(ingredientFindMany).toHaveBeenCalledWith({ where: { slug: { not: null } } });
  });

  it("gibt Foods ohne Nährwerte als nutrition = null zurück (keine erfundenen Nullen)", async () => {
    ingredientFindMany.mockResolvedValue([foodRow("db-x", "Eiersatz", null)]);
    const catalog = await loadFoodCatalog();
    expect(catalog.get("db-x")?.nutrition).toBeNull();
  });
});

describe("loadStructuredIngredients", () => {
  it("gruppiert nach Rezept in Positionsreihenfolge und validiert die Einheit", async () => {
    recipeIngredientFindMany.mockResolvedValue([
      ingredientRow("r1", 0, "db-skyr"),
      ingredientRow("r1", 1, "db-banane", { unit: "kaputt", amount: 2 }),
      ingredientRow("r2", 0, "db-quark", { gramsOverride: 80, note: "groß" }),
    ]);
    const map = await loadStructuredIngredients(["r1", "r2"]);
    expect(map.get("r1")).toHaveLength(2);
    expect(map.get("r1")![1].unit).toBeNull();
    expect(map.get("r2")![0]).toMatchObject({ gramsOverride: 80, note: "groß" });
    expect(recipeIngredientFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recipeId: { in: ["r1", "r2"] }, foodId: { not: null } } }));
  });

  it("fragt bei leerer Liste gar nicht erst die DB", async () => {
    expect((await loadStructuredIngredients([])).size).toBe(0);
    expect(recipeIngredientFindMany).not.toHaveBeenCalled();
  });
});

describe("analyzeRecipesForProfile", () => {
  it("liefert Match und personalisierte Variante: Magerquark statt Skyr", async () => {
    const result = await analyzeRecipesForProfile("p1", [{ id: "r-skyr", servings: 1, ingredients: '["100 g Skyr","1 Banane"]' }]);
    const analysis = result.get("r-skyr")!;
    expect(analysis.match.relevant).toBe(true);
    expect(analysis.match.hasDislikedConflict).toBe(true); // Banane wird abgelehnt
    expect(analysis.personalized?.adapted).toBe(true);
    expect(analysis.personalized?.ingredientLines[0]).toBe("100 g Magerquark");

    const input = toPersonalizationInput(analysis.personalized);
    expect(input?.swaps).toEqual([{ from: "Skyr", to: "Magerquark" }]);
    expect(input?.kcal).toBeGreaterThan(0);
  });

  it("lässt Rezepte ohne strukturierte Zutaten unpersonalisiert und gleicht per Freitext ab", async () => {
    const result = await analyzeRecipesForProfile("p1", [{ id: "legacy", servings: 1, ingredients: '["200 g Magerquark"]' }]);
    const analysis = result.get("legacy")!;
    expect(analysis.personalized).toBeNull();
    expect(analysis.match.relevant).toBe(true);
    expect(toPersonalizationInput(analysis.personalized)).toBeUndefined();
  });

  it("gibt für nicht angepasste Rezepte keine Personalisierung zurück", async () => {
    profileFindUnique.mockResolvedValue({ likedFoods: [], dislikedFoods: [] });
    const result = await analyzeRecipesForProfile("p1", [{ id: "r-skyr", servings: 1, ingredients: "[]" }]);
    expect(toPersonalizationInput(result.get("r-skyr")!.personalized)).toBeUndefined();
  });

  it("liefert bei leerer Rezeptliste eine leere Map ohne DB-Zugriff", async () => {
    expect((await analyzeRecipesForProfile("p1", [])).size).toBe(0);
    expect(ingredientFindMany).not.toHaveBeenCalled();
  });
});
