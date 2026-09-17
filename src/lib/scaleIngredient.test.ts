import { describe, expect, it } from "vitest";
import { scaleIngredientText } from "./scaleIngredient";

describe("scaleIngredientText", () => {
  it("scales a leading decimal amount", () => {
    expect(scaleIngredientText("200 g Hüttenkäse", 2)).toBe("400 g Hüttenkäse");
  });

  it("scales a leading fraction amount", () => {
    expect(scaleIngredientText("1/2 Zwiebel", 2)).toBe("1 Zwiebel");
  });

  it("leaves text without a leading number unchanged", () => {
    expect(scaleIngredientText("Salz nach Geschmack", 2)).toBe("Salz nach Geschmack");
  });

  it("is a no-op for a factor very close to 1", () => {
    expect(scaleIngredientText("200 g Reis", 1.02)).toBe("200 g Reis");
  });

  it("never scales below the 0.5 floor", () => {
    expect(scaleIngredientText("1 Ei", 0.1)).toBe("0,5 Ei");
  });

  it("uses a comma for non-integer results", () => {
    expect(scaleIngredientText("100 g Reis", 1.5)).toBe("150 g Reis");
    expect(scaleIngredientText("100 g Reis", 1.25)).toBe("125 g Reis");
  });
});
