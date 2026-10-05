import { beforeEach, describe, expect, it, vi } from "vitest";

const ingredientFindMany = vi.fn();
const alternativeFindMany = vi.fn();
const recipeIngredientFindMany = vi.fn();
const profileFindUnique = vi.fn();
const recipeFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    ingredient: { findMany: (...args: unknown[]) => ingredientFindMany(...args) },
    ingredientAlternative: { findMany: (...args: unknown[]) => alternativeFindMany(...args) },
    recipeIngredient: { findMany: (...args: unknown[]) => recipeIngredientFindMany(...args) },
    profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) },
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
  },
}));

const { analyzeRecipesForProfile, loadCatalogRecipes, loadFoodCatalog, loadStructuredIngredients, toPersonalizationInput } = await import("./recipeService");
const { deriveDietClass } = await import("./diet");

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

  it("liest unitGrams geprüft ein", async () => {
    ingredientFindMany.mockResolvedValue([foodRow("db-milch", "Milch", 64, { unitGrams: '{"ml":1.03}' })]);
    const catalog = await loadFoodCatalog();
    expect(catalog.get("db-milch")?.unitGrams).toEqual({ ml: 1.03 });
  });

  it("nutzt bei unlesbaren JSON-Spalten wie bisher den Standardwert, meldet das aber je Spalte (R5D)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingredientFindMany.mockResolvedValue([
      foodRow("db-kaputt", "Kaputt", 50, { aliases: "[kaputt", allergens: '{"milch":true}', unitGrams: '{"ml":"1.03"}' }),
      foodRow("db-ok", "Skyr", 63),
    ]);
    const catalog = await loadFoodCatalog();
    expect(catalog.size).toBe(2);
    expect(catalog.get("db-kaputt")).toMatchObject({ aliases: [], allergens: [], unitGrams: undefined });
    expect(catalog.get("db-ok")?.allergens).toEqual(["milch"]);
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('Ingredient db-kaputt: Spalte "allergens" hat nicht die erwartete Form'),
      expect.stringContaining('Ingredient db-kaputt: Spalte "aliases" enthält kein gültiges JSON'),
      expect.stringContaining('Ingredient db-kaputt: Spalte "unitGrams" hat nicht die erwartete Form'),
    ]);
    warn.mockRestore();
  });
});

describe("loadFoodCatalog: dietClass aus der String-Spalte (L-2)", () => {
  it.each(["vegan", "vegetarian", "pescatarian", "omnivore"])("übernimmt den gültigen Wert %s unverändert", async (dietClass) => {
    ingredientFindMany.mockResolvedValue([foodRow("db-x", "Testfood", 50, { dietClass })]);
    const catalog = await loadFoodCatalog();
    expect(catalog.get("db-x")?.dietClass).toBe(dietClass);
  });

  it("ohne Wert gilt das Food wie bisher als omnivore, ohne Warnung", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingredientFindMany.mockResolvedValue([foodRow("db-x", "Testfood", 50, { dietClass: null })]);
    const catalog = await loadFoodCatalog();
    expect(catalog.get("db-x")?.dietClass).toBe("omnivore");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each(["Vegan", "VEGAN", "fleisch", ""])("ein unbekannter Wert (%j) gilt konservativ als omnivore und wird gemeldet", async (dietClass) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ingredientFindMany.mockResolvedValue([foodRow("db-x", "Testfood", 50, { dietClass })]);
    const catalog = await loadFoodCatalog();
    expect(catalog.get("db-x")?.dietClass).toBe("omnivore");
    expect(warn.mock.calls.map(([message]) => message)).toEqual([expect.stringContaining(`Ingredient db-x: unbekannte dietClass "${dietClass}"`)]);
    warn.mockRestore();
  });

  it("ein Food mit unbekanntem Wert macht ein Rezept nicht vegan (vorher: Food zählte gar nicht)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ingredientFindMany.mockResolvedValue([
      foodRow("db-tofu", "Tofu", 120, { dietClass: "vegan" }),
      foodRow("db-speck", "Speck", 500, { dietClass: "Fleisch" }),
    ]);
    const catalog = await loadFoodCatalog();
    const ingredients = ["db-tofu", "db-speck"].map((foodId, position) => ({ position, foodId, displayName: foodId, amount: 100, unit: "g" as const, optional: false }));
    expect(deriveDietClass(ingredients, catalog)).toBe("omnivore");
    vi.restoreAllMocks();
  });
});

describe("loadCatalogRecipes (R5D)", () => {
  function recipeRow(id: string, extra: Record<string, unknown> = {}) {
    return {
      id,
      slug: id,
      name: id,
      description: "",
      kcal: 400,
      proteinG: 30,
      carbsG: 40,
      fatG: 10,
      totalTimeMin: 20,
      prepTimeMin: 10,
      servings: 1,
      mealSlots: '["LUNCH"]',
      dietTypes: '["VEGETARIAN"]',
      tags: "[]",
      mealPrepSuitable: false,
      cuisine: null,
      allergens: '["milch"]',
      ingredients: '["100 g Skyr"]',
      ...extra,
    };
  }

  it("lässt ein Rezept mit unlesbarer Allergenliste mit Warnung aus, statt es als allergenfrei zu zeigen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recipeFindMany.mockResolvedValue([recipeRow("r-ok"), recipeRow("r-kaputt", { allergens: "milch" })]);
    recipeIngredientFindMany.mockResolvedValue([]);
    const entries = await loadCatalogRecipes();
    expect(entries.map((e) => e.recipe.id)).toEqual(["r-ok"]);
    expect(entries[0].recipe).toMatchObject({ mealSlots: ["LUNCH"], dietTypes: ["VEGETARIAN"], allergens: ["milch"], ingredientLines: ["100 g Skyr"] });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Recipe r-kaputt: Spalte "allergens" enthält kein gültiges JSON'));
    warn.mockRestore();
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
