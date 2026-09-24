import { beforeEach, describe, expect, it, vi } from "vitest";

const pantryItemFindMany = vi.fn();
const pantryItemCreate = vi.fn();
const pantryItemFindFirst = vi.fn();
const pantryItemUpdate = vi.fn();
const pantryItemDeleteMany = vi.fn();
const ingredientFindUnique = vi.fn();
const ingredientCreate = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    pantryItem: {
      findMany: (...args: unknown[]) => pantryItemFindMany(...args),
      create: (...args: unknown[]) => pantryItemCreate(...args),
      findFirst: (...args: unknown[]) => pantryItemFindFirst(...args),
      update: (...args: unknown[]) => pantryItemUpdate(...args),
      deleteMany: (...args: unknown[]) => pantryItemDeleteMany(...args),
    },
    ingredient: {
      findUnique: (...args: unknown[]) => ingredientFindUnique(...args),
      create: (...args: unknown[]) => ingredientCreate(...args),
      // Leerer Food-Katalog: findOrCreateIngredient löst dann nichts kanonisch auf (Verhalten dieser Tests unverändert).
      findMany: async () => [],
    },
    ingredientAlternative: { findMany: async () => [] },
  },
}));

const { listPantryItems, createPantryItem, updatePantryItem, deletePantryItem, adjustPantryItemQuantity } =
  await import("./pantryService");

beforeEach(() => {
  vi.clearAllMocks();
});

const validCreateInput = {
  name: "Hähnchenbrust",
  quantity: 500,
  unit: "G" as const,
  expirationDateType: "UNKNOWN" as const,
  location: "FRIDGE" as const,
  opened: false,
  cooked: false,
};

describe("listPantryItems", () => {
  it("scopes the query to the given household and returns an empty list for an empty pantry", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    const items = await listPantryItems("household-A");
    expect(pantryItemFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "household-A" } }),
    );
    expect(items).toEqual([]);
  });

  it("sorts items by rotation priorityScore descending", async () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const base = { name: "Item", quantity: 1, remainingQuantity: 1, location: "OTHER", expirationDateType: "UNKNOWN" };
    pantryItemFindMany.mockResolvedValueOnce([
      { ...base, id: "fresh", opened: false, cooked: false, expirationDate: null, purchaseDate: now },
      { ...base, id: "expired", opened: false, cooked: false, expirationDate: new Date("2026-09-01"), purchaseDate: now, expirationDateType: "EXACT" },
    ]);
    const items = await listPantryItems("household-A", now);
    expect(items[0].id).toBe("expired");
  });
});

describe("createPantryItem", () => {
  it("creates an item linked to an existing ingredient by explicit ingredientId (item with a link)", async () => {
    ingredientFindUnique.mockResolvedValueOnce({ id: "ing-1", name: "Reis" });
    pantryItemCreate.mockResolvedValueOnce({ id: "item-1" });

    await createPantryItem("household-A", { ...validCreateInput, name: "Reis", ingredientId: "ing-1" });

    expect(pantryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ householdId: "household-A", ingredientId: "ing-1" }) }),
    );
  });

  it("auto-creates a catalog ingredient when none was given (item without an explicit link)", async () => {
    ingredientFindUnique.mockResolvedValue(null);
    ingredientCreate.mockResolvedValueOnce({ id: "ing-auto", name: "Hähnchenbrust" });
    pantryItemCreate.mockResolvedValueOnce({ id: "item-2" });

    await createPantryItem("household-A", validCreateInput);

    expect(pantryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ingredientId: "ing-auto" }) }),
    );
  });

  it("sets remainingQuantity to the initial quantity on creation", async () => {
    ingredientFindUnique.mockResolvedValue(null);
    ingredientCreate.mockResolvedValueOnce({ id: "ing-1" });
    pantryItemCreate.mockResolvedValueOnce({ id: "item-1" });

    await createPantryItem("household-A", { ...validCreateInput, quantity: 750 });

    expect(pantryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ quantity: 750, remainingQuantity: 750 }) }),
    );
  });

  it("scopes the new item to the given household", async () => {
    ingredientFindUnique.mockResolvedValue(null);
    ingredientCreate.mockResolvedValueOnce({ id: "ing-1" });
    pantryItemCreate.mockResolvedValueOnce({ id: "item-1" });

    await createPantryItem("household-B", validCreateInput);

    expect(pantryItemCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ householdId: "household-B" }) }),
    );
  });
});

describe("Household-Isolation: fremde Pantry Items dürfen nicht gelesen/geändert/gelöscht werden", () => {
  it("updatePantryItem returns null for an item that belongs to a different household, even with the correct item id", async () => {
    // Die Query nach { id, householdId: "household-B" } findet nichts, weil das Item household-A gehört.
    pantryItemFindFirst.mockResolvedValueOnce(null);

    const result = await updatePantryItem("household-B", "item-of-household-A", validCreateInput);

    expect(result).toBeNull();
    expect(pantryItemFindFirst).toHaveBeenCalledWith({ where: { id: "item-of-household-A", householdId: "household-B" } });
    expect(pantryItemUpdate).not.toHaveBeenCalled();
  });

  it("deletePantryItem does not delete an item belonging to a different household", async () => {
    pantryItemDeleteMany.mockResolvedValueOnce({ count: 0 });

    const result = await deletePantryItem("household-B", "item-of-household-A");

    expect(result).toBe(false);
    expect(pantryItemDeleteMany).toHaveBeenCalledWith({ where: { id: "item-of-household-A", householdId: "household-B" } });
  });

  it("adjustPantryItemQuantity returns null for an item belonging to a different household", async () => {
    pantryItemFindFirst.mockResolvedValueOnce(null);

    const result = await adjustPantryItemQuantity("household-B", "item-of-household-A", { type: "add", amount: 100 });

    expect(result).toBeNull();
    expect(pantryItemUpdate).not.toHaveBeenCalled();
  });

  it("updatePantryItem succeeds for an item that genuinely belongs to the given household", async () => {
    pantryItemFindFirst.mockResolvedValueOnce({ id: "item-1", householdId: "household-A", expirationDateType: "UNKNOWN" });
    ingredientFindUnique.mockResolvedValue(null);
    ingredientCreate.mockResolvedValueOnce({ id: "ing-1" });
    pantryItemUpdate.mockResolvedValueOnce({ id: "item-1" });

    const result = await updatePantryItem("household-A", "item-1", validCreateInput);

    expect(result).not.toBeNull();
    expect(pantryItemUpdate).toHaveBeenCalled();
  });
});
