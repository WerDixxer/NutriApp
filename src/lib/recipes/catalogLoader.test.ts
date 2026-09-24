import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRecipes, buildSeedCatalog } from "./data/build";

/**
 * loadCatalogRecipes gegen einen In-Memory-Ersatz der Recipe-/RecipeIngredient-Tabellen (aus den
 * Seed-Daten gebaut). Enthält zusätzlich ein eigenes Rezept und ein Altrezept OHNE slug, die nicht
 * zum Katalog gehören. Keine echte Datenbank.
 */
const built = buildRecipes(buildSeedCatalog());

function recipeRow(index: number, slug: string | null, overrides: Record<string, unknown> = {}) {
  const r = built[index % built.length];
  return {
    id: slug ?? `nonslug-${index}`,
    slug,
    name: slug ? r.name : `Eigenes Rezept ${index}`,
    description: r.description,
    imageQuery: null,
    kcal: r.nutrition.kcal,
    proteinG: r.nutrition.proteinG,
    carbsG: r.nutrition.carbsG,
    fatG: r.nutrition.fatG,
    prepTimeMin: r.prepTimeMin,
    totalTimeMin: slug ? r.totalTimeMin : null,
    servings: r.servings,
    mealSlots: JSON.stringify(r.mealSlots),
    dietTypes: JSON.stringify(r.dietTypes),
    allergens: JSON.stringify(r.allergens),
    tags: JSON.stringify(r.tags),
    ingredients: JSON.stringify(r.ingredientLines),
    instructions: JSON.stringify(r.instructions),
    isTrending: false,
    trendSource: null,
    isCustom: !slug,
    mealPrepSuitable: r.mealPrepSuitable,
    cuisine: r.cuisine,
    createdAt: new Date(2026, 0, 1, 0, 0, index),
    ...overrides,
  };
}

const recipeFindMany = vi.fn();
const recipeIngredientFindMany = vi.fn();
const profileFindUnique = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    recipe: { findMany: (...args: unknown[]) => recipeFindMany(...args) },
    recipeIngredient: { findMany: (...args: unknown[]) => recipeIngredientFindMany(...args) },
    profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) },
    ingredient: { findMany: async () => [] },
    ingredientAlternative: { findMany: async () => [] },
  },
}));

const { loadCatalogRecipes, loadBrowsePreferences } = await import("./recipeService");

beforeEach(() => {
  vi.clearAllMocks();
  const rows = [
    ...built.map((r, i) => recipeRow(i, r.slug)),
    recipeRow(100, null, { name: "Omas Eintopf" }), // eigenes Rezept
    recipeRow(101, null, { name: "Altrezept", isCustom: false }), // Altrezept ohne Struktur
  ];
  recipeFindMany.mockImplementation(async ({ where }: { where?: { slug?: { not: null } } } = {}) =>
    where?.slug ? rows.filter((r) => r.slug !== null) : rows,
  );
  recipeIngredientFindMany.mockImplementation(async ({ where }: { where: { recipeId: { in: string[] } } }) =>
    built
      .filter((r) => where.recipeId.in.includes(r.slug))
      .flatMap((r) =>
        r.ingredients.map((i, position) => ({
          recipeId: r.slug,
          position,
          foodId: i.foodId,
          displayName: i.displayName,
          amount: i.amount,
          unit: i.unit,
          optional: i.optional,
          note: i.note ?? null,
          gramsOverride: i.gramsOverride ?? null,
        })),
      ),
  );
});

describe("loadCatalogRecipes", () => {
  it("liefert die 60 strukturierten Katalog-Rezepte, nicht mehr nur indirekt über Planer/Assistant", async () => {
    const entries = await loadCatalogRecipes();
    expect(entries).toHaveLength(60);
    for (const { recipe } of entries) {
      expect(recipe.slug).toBeTruthy();
      expect(recipe.ingredients.length).toBeGreaterThan(0);
    }
  });

  it("fragt nur Rezepte mit slug ab: eigene Rezepte und Altrezepte gehören nicht in den Katalog", async () => {
    const entries = await loadCatalogRecipes();
    expect(recipeFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: { not: null } } }));
    expect(entries.map((e) => e.recipe.name)).not.toContain("Omas Eintopf");
    expect(entries.map((e) => e.recipe.name)).not.toContain("Altrezept");
  });

  it("verändert nichts: nur lesende Abfragen", async () => {
    await loadCatalogRecipes();
    expect(recipeFindMany).toHaveBeenCalledTimes(1);
    expect(recipeIngredientFindMany).toHaveBeenCalledTimes(1);
  });

  it("übernimmt Zeit, Tags, Mahlzeiten, Ernährungsformen und Meal-Prep-Kennzeichen aus der Zeile", async () => {
    const entries = await loadCatalogRecipes();
    const pancakes = entries.find((e) => e.recipe.slug === "protein-pancakes-with-berries")!.recipe;
    const seed = built.find((r) => r.slug === "protein-pancakes-with-berries")!;
    expect(pancakes).toMatchObject({
      timeMin: seed.totalTimeMin,
      mealSlots: seed.mealSlots,
      dietTypes: seed.dietTypes,
      tags: seed.tags,
      mealPrepSuitable: seed.mealPrepSuitable,
      cuisine: seed.cuisine,
    });
  });

  it("die Zutatenzeilen entstehen aus den strukturierten RecipeIngredient-Zeilen", async () => {
    const entries = await loadCatalogRecipes();
    for (const { recipe } of entries) {
      const seed = built.find((r) => r.slug === recipe.slug)!;
      expect(recipe.ingredientLines).toEqual(seed.ingredientLines);
      expect(recipe.ingredients.map((i) => i.foodId)).toEqual(seed.ingredients.map((i) => i.foodId));
    }
  });
});

describe("loadBrowsePreferences", () => {
  it("liest Allergien, Lieblinge und Abneigungen des Profils (nur lesend)", async () => {
    profileFindUnique.mockResolvedValueOnce({
      allergies: [{ label: "Erdnüsse" }],
      likedFoods: [{ label: "Hähnchen" }],
      dislikedFoods: [{ label: "Rosenkohl" }],
    });
    const preferences = await loadBrowsePreferences("profile-1");
    expect(preferences).toEqual({ allergyLabels: ["Erdnüsse"], favoriteFoods: ["Hähnchen"], dislikedFoods: ["Rosenkohl"] });
    expect(profileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "profile-1" } }));
  });

  it("ein fehlendes Profil ergibt leere Präferenzen statt eines Fehlers", async () => {
    profileFindUnique.mockResolvedValueOnce(null);
    expect(await loadBrowsePreferences("missing")).toEqual({ allergyLabels: [], favoriteFoods: [], dislikedFoods: [] });
  });
});
