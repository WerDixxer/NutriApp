import { describe, expect, it } from "vitest";
import { applyQuantityAdjustment } from "./adjustQuantity";

describe("applyQuantityAdjustment", () => {
  it("adds to the current remaining quantity", () => {
    const result = applyQuantityAdjustment(200, { type: "add", amount: 300 });
    expect(result).toEqual({ remainingQuantity: 500, isEmpty: false });
  });

  it("consumes from the current remaining quantity", () => {
    const result = applyQuantityAdjustment(500, { type: "consume", amount: 200 });
    expect(result).toEqual({ remainingQuantity: 300, isEmpty: false });
  });

  it("sets an absolute remaining quantity", () => {
    const result = applyQuantityAdjustment(500, { type: "set", amount: 120 });
    expect(result).toEqual({ remainingQuantity: 120, isEmpty: false });
  });

  it("never goes negative when consuming more than is left", () => {
    const result = applyQuantityAdjustment(100, { type: "consume", amount: 500 });
    expect(result.remainingQuantity).toBe(0);
    expect(result.isEmpty).toBe(true);
  });

  it("never accepts a negative set amount as a negative remaining quantity", () => {
    const result = applyQuantityAdjustment(100, { type: "set", amount: -50 });
    expect(result.remainingQuantity).toBe(0);
  });

  it("marks a fully consumed item as empty", () => {
    const result = applyQuantityAdjustment(100, { type: "consume", amount: 100 });
    expect(result.isEmpty).toBe(true);
    expect(result.remainingQuantity).toBe(0);
  });

  it("avoids floating-point drift (0.1 + 0.2 style errors)", () => {
    const result = applyQuantityAdjustment(0.1, { type: "add", amount: 0.2 });
    expect(result.remainingQuantity).toBe(0.3);
  });

  it("rounds to 2 decimal places", () => {
    const result = applyQuantityAdjustment(1, { type: "consume", amount: 0.333 });
    expect(result.remainingQuantity).toBe(0.67);
  });
});
