import { describe, expect, it } from "vitest";
import { mealPrepQuerySchema } from "./mealPrep";

describe("mealPrepQuerySchema", () => {
  it("verwendet BALANCED als Default-Strategie", () => {
    expect(mealPrepQuerySchema.parse({}).strategy).toBe("BALANCED");
  });

  it("akzeptiert alle drei gültigen Strategien", () => {
    for (const s of ["MIN_COOKING", "BALANCED", "FRESHNESS"]) {
      expect(mealPrepQuerySchema.safeParse({ strategy: s }).success).toBe(true);
    }
  });

  it("lehnt eine unbekannte Strategie ab", () => {
    expect(mealPrepQuerySchema.safeParse({ strategy: "FASTEST" }).success).toBe(false);
  });
});
