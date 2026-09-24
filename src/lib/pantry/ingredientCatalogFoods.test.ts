import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chapter 14: findOrCreateIngredient / createPantryItem gegen einen In-Memory-Ersatz der
 * Ingredient-Tabelle. Keine echte Datenbank. Die kuratierten Foods (mit slug) bilden den
 * FoodCatalog; freie Zutaten haben keinen slug.
 */
interface Row {
  id: string;
  slug: string | null;
  name: string;
  normalizedName: string;
  aliases: string | null;
  defaultUnit?: string | null;
  [key: string]: unknown;
}

function curated(id: string, name: string, aliases: string[] = []): Row {
  return {
    id,
    slug: id,
    name,
    normalizedName: name.toLowerCase(),
    aliases: JSON.stringify(aliases),
    category: "other",
    dietClass: "omnivore",
    allergens: "[]",
    negligible: false,
    unitGrams: null,
    kcalPer100: null,
  };
}

let table: Row[] = [];
let nextId = 1;

const ingredientCreate = vi.fn(async ({ data }: { data: Partial<Row> & { name: string; normalizedName: string } }) => {
  const row = { id: `free-${nextId++}`, slug: null, aliases: null, ...data } as Row;
  table.push(row);
  return row;
});
const pantryItemCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "item-1", ...data }));

vi.mock("../db", () => ({
  prisma: {
    ingredient: {
      findMany: async ({ where }: { where?: { slug?: { not: null } } } = {}) => (where?.slug ? table.filter((r) => r.slug !== null) : table),
      findUnique: async ({ where }: { where: { id?: string; normalizedName?: string } }) =>
        table.find((r) => (where.id ? r.id === where.id : r.normalizedName === where.normalizedName)) ?? null,
      create: (args: Parameters<typeof ingredientCreate>[0]) => ingredientCreate(args),
    },
    ingredientAlternative: { findMany: async () => [] },
    pantryItem: { create: (args: Parameters<typeof pantryItemCreate>[0]) => pantryItemCreate(args) },
  },
}));

const { findOrCreateIngredient } = await import("./ingredientCatalog");
const { createPantryItem } = await import("./pantryService");

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  table = [
    curated("food-paprika", "Paprika"),
    curated("food-haehnchen", "Hähnchenbrust", ["Hühnchen", "Hähnchen"]),
    curated("food-pasta", "Pasta", ["Nudeln", "Spaghetti"]),
    curated("food-reis", "Reis"),
    curated("food-reiswaffeln", "Reiswaffeln"),
    curated("food-alpha", "Alpha", ["gemeinsam"]),
    curated("food-beta", "Beta", ["gemeinsam"]),
    { id: "free-test", slug: null, name: "Haushalt-Test-Item", normalizedName: "haushalt-test-item", aliases: null },
  ];
});

describe("findOrCreateIngredient: kanonische Foods zuerst", () => {
  it.each([
    ["Paprika", "food-paprika"],
    ["  paprika ", "food-paprika"],
    ["Hähnchenbrust", "food-haehnchen"],
    ["Hühnchen", "food-haehnchen"], // Alias
    ["Nudeln", "food-pasta"], // Alias
  ])("'%s' führt auf das bestehende Food %s und legt nichts Neues an", async (name, id) => {
    const before = table.length;
    const result = await findOrCreateIngredient(name);
    expect(result?.id).toBe(id);
    expect(ingredientCreate).not.toHaveBeenCalled();
    expect(table).toHaveLength(before);
  });

  it("'Reis' bleibt ein eigenes Food und wird nicht mit 'Reiswaffeln' verwechselt", async () => {
    expect((await findOrCreateIngredient("Reis"))?.id).toBe("food-reis");
    expect((await findOrCreateIngredient("Reiswaffeln"))?.id).toBe("food-reiswaffeln");
  });
});

describe("findOrCreateIngredient: unbekannte Begriffe bleiben freie Zutaten", () => {
  it.each(["Rosenkohl", "Blumenkohl", "Algen"])("'%s' wird als freies Ingredient angelegt, ohne Food-Zuordnung", async (name) => {
    const result = await findOrCreateIngredient(name, "G");
    expect(ingredientCreate).toHaveBeenCalledWith({ data: { name, normalizedName: name.toLowerCase(), defaultUnit: "G" } });
    expect(result?.slug).toBeNull();
  });

  it("ein zweiter Aufruf findet die bereits angelegte freie Zutat, statt sie zu duplizieren", async () => {
    const first = await findOrCreateIngredient("Rosenkohl");
    const second = await findOrCreateIngredient("rosenkohl");
    expect(second?.id).toBe(first?.id);
    expect(ingredientCreate).toHaveBeenCalledTimes(1);
  });

  it("ein mehrdeutiger Alias wird nicht geraten: freie Zutat statt zufälligem Food", async () => {
    const result = await findOrCreateIngredient("gemeinsam");
    expect(result?.slug).toBeNull();
    expect(ingredientCreate).toHaveBeenCalledTimes(1);
  });

  it("der bekannte Testeintrag 'Haushalt-Test-Item' bleibt eine freie Zutat und wird unverändert wiedergefunden", async () => {
    const result = await findOrCreateIngredient("Haushalt-Test-Item");
    expect(result?.id).toBe("free-test");
    expect(ingredientCreate).not.toHaveBeenCalled();
  });

  it("ein leerer Name liefert weiterhin null", async () => {
    expect(await findOrCreateIngredient("   ")).toBeNull();
  });
});

describe("createPantryItem: Pantry zeigt auf das zentrale Food", () => {
  const input = {
    quantity: 500,
    unit: "G" as const,
    expirationDateType: "UNKNOWN" as const,
    location: "FRIDGE" as const,
    opened: false,
    cooked: false,
  };

  it("'Hühnchen' wird mit ingredientId = Hähnchenbrust gespeichert, der eingegebene Name bleibt erhalten", async () => {
    await createPantryItem("household-A", { ...input, name: "Hühnchen" } as never);
    expect(pantryItemCreate.mock.calls[0][0].data).toMatchObject({ ingredientId: "food-haehnchen", name: "Hühnchen", householdId: "household-A" });
  });

  it("'Rosenkohl' bekommt ein freies Ingredient statt eines Foods", async () => {
    await createPantryItem("household-A", { ...input, name: "Rosenkohl" } as never);
    const data = pantryItemCreate.mock.calls[0][0].data;
    expect(data.ingredientId).toMatch(/^free-/);
    expect(table.find((r) => r.id === data.ingredientId)?.slug).toBeNull();
  });

  it("ein explizit übergebenes ingredientId wird weiter respektiert (bestehendes Verhalten)", async () => {
    await createPantryItem("household-A", { ...input, name: "Irgendwas", ingredientId: "food-paprika" } as never);
    expect(pantryItemCreate.mock.calls[0][0].data.ingredientId).toBe("food-paprika");
  });
});
