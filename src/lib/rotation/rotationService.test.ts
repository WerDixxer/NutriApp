import { beforeEach, describe, expect, it, vi } from "vitest";

const pantryItemFindMany = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    pantryItem: { findMany: (...args: unknown[]) => pantryItemFindMany(...args) },
  },
}));

const { getHouseholdRotation, getPantryContextForHousehold } = await import("./rotationService");

beforeEach(() => {
  vi.clearAllMocks();
});

const now = new Date("2026-09-17T12:00:00Z");

function dbItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "item-1",
    name: "Testprodukt",
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

describe("getHouseholdRotation: Household-Isolation", () => {
  it("fragt ausschließlich Items des übergebenen Haushalts ab", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    await getHouseholdRotation("household-A", now);
    expect(pantryItemFindMany).toHaveBeenCalledWith({ where: { householdId: "household-A" } });
  });

  it("funktioniert mit einer leeren Pantry ohne Fehler", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    const rotation = await getHouseholdRotation("household-A", now);
    expect(rotation.results).toEqual([]);
    expect(rotation.useFirst).toEqual([]);
    expect(rotation.planMeal).toEqual([]);
  });

  it("lädt Items nur einmal (eine einzige Query), nicht pro Item", async () => {
    pantryItemFindMany.mockResolvedValueOnce([dbItem({ id: "a" }), dbItem({ id: "b" }), dbItem({ id: "c" })]);
    await getHouseholdRotation("household-A", now);
    expect(pantryItemFindMany).toHaveBeenCalledTimes(1);
  });

  it("gruppiert dringende und weniger dringende Items korrekt", async () => {
    pantryItemFindMany.mockResolvedValueOnce([
      dbItem({ id: "urgent", opened: true, expirationDate: now, expirationDateType: "EXACT" }),
      dbItem({ id: "later", purchaseDate: new Date("2026-09-16") }),
    ]);
    const rotation = await getHouseholdRotation("household-A", now);
    expect(rotation.useFirst.some((r) => r.pantryItemId === "urgent")).toBe(true);
  });
});

describe("getPantryContextForHousehold: Integration mit der Decision Engine", () => {
  it("liefert sowohl verfügbare als auch dringende Zutatennamen aus einer einzigen Query", async () => {
    pantryItemFindMany.mockResolvedValueOnce([
      dbItem({ id: "urgent-spinach", name: "Spinat", expirationDate: now, expirationDateType: "EXACT" }),
      dbItem({ id: "calm-rice", name: "Reis" }),
    ]);

    const context = await getPantryContextForHousehold("household-A", now);

    expect(pantryItemFindMany).toHaveBeenCalledTimes(1);
    expect(context.availableIngredientNames).toEqual(["Spinat", "Reis"]);
    expect(context.urgentIngredientNames).toEqual(["Spinat"]);
  });

  it("scopes die Query auf remainingQuantity > 0 und den übergebenen Haushalt", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    await getPantryContextForHousehold("household-B", now);
    expect(pantryItemFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-B", remainingQuantity: { gt: 0 } },
    });
  });

  it("gibt leere Listen für eine leere Pantry zurück, ohne Fehler", async () => {
    pantryItemFindMany.mockResolvedValueOnce([]);
    const context = await getPantryContextForHousehold("household-A", now);
    expect(context).toEqual({ availableIngredientNames: [], urgentIngredientNames: [] });
  });
});
