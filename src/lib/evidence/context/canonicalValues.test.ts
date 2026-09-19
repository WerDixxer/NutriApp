import { describe, expect, it } from "vitest";
import { kerksick2017Claims } from "../data/kerksick2017";
import { CANONICAL_TRAINING_TYPES } from "./canonicalValues";

describe("CANONICAL_TRAINING_TYPES: aus den echten kuratierten Claims abgeleitet", () => {
  it("enthält exakt die tatsächlich in der Evidence Library vorkommenden trainingType-Werte", () => {
    const actualValues = new Set(
      kerksick2017Claims.map((c) => c.trainingType).filter((v): v is string => v !== null),
    );
    expect(actualValues).toEqual(new Set(CANONICAL_TRAINING_TYPES));
  });

  it("enthält KEINEN Wert, der in keinem Claim vorkommt (keine erfundene Kategorie)", () => {
    const actualValues = new Set(kerksick2017Claims.map((c) => c.trainingType));
    for (const canonical of CANONICAL_TRAINING_TYPES) {
      expect(actualValues.has(canonical)).toBe(true);
    }
  });
});
