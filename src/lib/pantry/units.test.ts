import { describe, expect, it } from "vitest";
import { convertQuantity, isConvertible } from "./units";

describe("convertQuantity", () => {
  it("converts 1000 g to 1 kg", () => {
    expect(convertQuantity(1000, "G", "KG")).toBe(1);
  });

  it("converts 1 kg to 1000 g", () => {
    expect(convertQuantity(1, "KG", "G")).toBe(1000);
  });

  it("converts 1000 ml to 1 l", () => {
    expect(convertQuantity(1000, "ML", "L")).toBe(1);
  });

  it("converts 1 l to 1000 ml", () => {
    expect(convertQuantity(1, "L", "ML")).toBe(1000);
  });

  it("returns the same amount when converting a unit to itself", () => {
    expect(convertQuantity(42, "G", "G")).toBe(42);
    expect(convertQuantity(3, "PIECE", "PIECE")).toBe(3);
  });

  it("refuses to invent a conversion between weight and count units (no fake '1 tomato = 120g')", () => {
    expect(convertQuantity(1, "PIECE", "G")).toBeNull();
    expect(convertQuantity(500, "G", "PIECE")).toBeNull();
  });

  it("refuses to convert between weight and volume", () => {
    expect(convertQuantity(500, "G", "ML")).toBeNull();
  });

  it("refuses to convert between different count units (piece vs pack vs portion)", () => {
    expect(convertQuantity(1, "PIECE", "PACK")).toBeNull();
    expect(convertQuantity(1, "PACK", "PORTION")).toBeNull();
  });
});

describe("isConvertible", () => {
  it("is true within the same dimension", () => {
    expect(isConvertible("G", "KG")).toBe(true);
  });

  it("is false across dimensions", () => {
    expect(isConvertible("PIECE", "G")).toBe(false);
  });
});
