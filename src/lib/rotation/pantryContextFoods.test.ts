import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSeedCatalog } from "../recipes/data/build";

const pantryItemFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: { pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) } },
}));

const { getPantryContextForHousehold } = await import("./rotationService");

const catalog = buildSeedCatalog();
const now = new Date("2026-09-17T12:00:00Z");

function dbItem(overrides: Partial<Record<string, unknown>>) {
  return {
    id: "item-1",
    name: "Reis",
    ingredientId: null,
    opened: false,
    cooked: false,
    quantity: 500,
    remainingQuantity: 500,
    expirationDate: null,
    expirationDateType: "UNKNOWN",
    purchaseDate: null,
    location: "OTHER",
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("getPantryContextForHousehold: Food-IDs der Vorräte (Chapter 14)", () => {
  it("liefert mit Katalog die Food-IDs je Pantry-Name; freie Zutaten fehlen", async () => {
    pantryItemFindMany.mockResolvedValueOnce([
      dbItem({ id: "a", name: "Hühnchen" }),
      dbItem({ id: "b", name: "Paprika", ingredientId: "paprika" }),
      dbItem({ id: "c", name: "Rosenkohl", ingredientId: "frei-1" }),
    ]);
    const context = await getPantryContextForHousehold("household-A", now, catalog);
    expect(context.foodIdsByName?.get("Hühnchen")).toEqual(["haehnchenbrust"]);
    expect(context.foodIdsByName?.get("Paprika")).toEqual(["paprika"]);
    expect(context.foodIdsByName?.has("Rosenkohl")).toBe(false);
    expect(context.availableIngredientNames).toEqual(["Hühnchen", "Paprika", "Rosenkohl"]);
  });

  it("ohne Katalog bleibt die Form des Kontexts unverändert (nur Namen)", async () => {
    pantryItemFindMany.mockResolvedValueOnce([dbItem({ id: "a", name: "Reis" })]);
    const context = await getPantryContextForHousehold("household-A", now);
    expect(context).toEqual({ availableIngredientNames: ["Reis"], urgentIngredientNames: [] });
  });

  it("fragt weiterhin nur Items des übergebenen Haushalts mit Restmenge ab", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    await getPantryContextForHousehold("household-A", now, catalog);
    expect(pantryItemFindMany).toHaveBeenCalledWith({ where: { householdId: "household-A", remainingQuantity: { gt: 0 } } });
  });
});
