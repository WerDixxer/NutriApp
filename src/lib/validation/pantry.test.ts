import { describe, expect, it } from "vitest";
import { adjustPantryQuantitySchema, createPantryItemSchema } from "./pantry";

const validItem = {
  name: "Hähnchenbrust",
  quantity: 500,
  unit: "G",
  expirationDateType: "UNKNOWN",
  location: "FRIDGE",
  opened: false,
  cooked: false,
};

describe("createPantryItemSchema", () => {
  it("accepts a minimal valid item", () => {
    expect(createPantryItemSchema.safeParse(validItem).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(createPantryItemSchema.safeParse({ ...validItem, name: "" }).success).toBe(false);
  });

  it("rejects a zero or negative quantity", () => {
    expect(createPantryItemSchema.safeParse({ ...validItem, quantity: 0 }).success).toBe(false);
    expect(createPantryItemSchema.safeParse({ ...validItem, quantity: -5 }).success).toBe(false);
  });

  it("rejects an invalid unit", () => {
    expect(createPantryItemSchema.safeParse({ ...validItem, unit: "LITER" }).success).toBe(false);
  });

  it("rejects an invalid location", () => {
    expect(createPantryItemSchema.safeParse({ ...validItem, location: "GARAGE" }).success).toBe(false);
  });

  describe("expirationDate <-> expirationDateType consistency", () => {
    it("accepts EXACT with a date", () => {
      const result = createPantryItemSchema.safeParse({
        ...validItem,
        expirationDateType: "EXACT",
        expirationDate: "2026-09-20",
      });
      expect(result.success).toBe(true);
    });

    it("accepts ESTIMATED with a date", () => {
      const result = createPantryItemSchema.safeParse({
        ...validItem,
        expirationDateType: "ESTIMATED",
        expirationDate: "2026-09-20",
      });
      expect(result.success).toBe(true);
    });

    it("rejects EXACT without a date", () => {
      const result = createPantryItemSchema.safeParse({ ...validItem, expirationDateType: "EXACT" });
      expect(result.success).toBe(false);
    });

    it("rejects UNKNOWN with a date present (would silently claim a known date)", () => {
      const result = createPantryItemSchema.safeParse({
        ...validItem,
        expirationDateType: "UNKNOWN",
        expirationDate: "2026-09-20",
      });
      expect(result.success).toBe(false);
    });

    it("accepts UNKNOWN with no date", () => {
      expect(createPantryItemSchema.safeParse(validItem).success).toBe(true);
    });
  });
});

describe("adjustPantryQuantitySchema", () => {
  it("accepts a valid add/consume/set payload", () => {
    expect(adjustPantryQuantitySchema.safeParse({ type: "add", amount: 100 }).success).toBe(true);
    expect(adjustPantryQuantitySchema.safeParse({ type: "consume", amount: 50 }).success).toBe(true);
    expect(adjustPantryQuantitySchema.safeParse({ type: "set", amount: 0 }).success).toBe(true);
  });

  it("rejects a negative amount", () => {
    expect(adjustPantryQuantitySchema.safeParse({ type: "add", amount: -10 }).success).toBe(false);
  });

  it("rejects an invalid adjustment type", () => {
    expect(adjustPantryQuantitySchema.safeParse({ type: "multiply", amount: 2 }).success).toBe(false);
  });
});
