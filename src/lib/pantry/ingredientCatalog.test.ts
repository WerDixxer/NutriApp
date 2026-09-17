import { beforeEach, describe, expect, it, vi } from "vitest";

const ingredientFindUnique = vi.fn();
const ingredientCreate = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    ingredient: {
      findUnique: (...args: unknown[]) => ingredientFindUnique(...args),
      create: (...args: unknown[]) => ingredientCreate(...args),
    },
  },
}));

const { findOrCreateIngredient, normalizeIngredientName } = await import("./ingredientCatalog");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeIngredientName", () => {
  it("trims and lowercases", () => {
    expect(normalizeIngredientName("  Hähnchenbrust  ")).toBe("hähnchenbrust");
  });
});

describe("findOrCreateIngredient", () => {
  it("returns an existing ingredient by normalized name instead of creating a duplicate", async () => {
    ingredientFindUnique.mockResolvedValueOnce({ id: "ing-1", name: "Reis", normalizedName: "reis" });

    const result = await findOrCreateIngredient("Reis");

    expect(result?.id).toBe("ing-1");
    expect(ingredientCreate).not.toHaveBeenCalled();
  });

  it("creates a new ingredient when none exists yet", async () => {
    ingredientFindUnique.mockResolvedValueOnce(null);
    ingredientCreate.mockResolvedValueOnce({ id: "ing-2", name: "Quinoa", normalizedName: "quinoa" });

    const result = await findOrCreateIngredient("Quinoa", "G");

    expect(result?.id).toBe("ing-2");
    expect(ingredientCreate).toHaveBeenCalledWith({
      data: { name: "Quinoa", normalizedName: "quinoa", defaultUnit: "G" },
    });
  });

  it("returns null for an empty name without touching the database", async () => {
    const result = await findOrCreateIngredient("   ");
    expect(result).toBeNull();
    expect(ingredientFindUnique).not.toHaveBeenCalled();
  });
});
