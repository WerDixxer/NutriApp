import { describe, expect, it } from "vitest";
import { computeMacroLoss } from "./loss";
import { DEFAULT_MACRO_LOSS_WEIGHTS } from "./lossWeights";
import { DEFAULT_MACRO_TOLERANCES } from "./tolerances";
import { buildRescueExplanation } from "./explanation";

describe("buildRescueExplanation", () => {
  it("nennt die tatsächlichen Kalorien- und Proteinwerte aus den übergebenen Daten", () => {
    const actual = { calories: 742, protein: 58, carbs: 60, fat: 18 };
    const { deviations } = computeMacroLoss(
      { calories: 750, protein: 60, carbs: 60, fat: 18 },
      actual,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
    );
    const text = buildRescueExplanation("Testgericht", 1.5, actual, deviations);
    expect(text).toContain("742 kcal");
    expect(text).toContain("58g Protein");
    expect(text).toContain("1,5 Portionen");
  });

  it("behauptet 'sehr nah an deinen Zielen' nur, wenn alle bewerteten Makros tatsächlich innerhalb der Toleranz liegen", () => {
    const closeActual = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const { deviations: closeDeviations } = computeMacroLoss(
      { calories: 650, protein: 55, carbs: 60, fat: 18 },
      closeActual,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
    );
    expect(buildRescueExplanation("X", 1, closeActual, closeDeviations)).toContain("sehr nah an deinen verbleibenden Zielen");

    const farActual = { calories: 1400, protein: 10, carbs: 60, fat: 18 };
    const { deviations: farDeviations } = computeMacroLoss(
      { calories: 650, protein: 55, carbs: 60, fat: 18 },
      farActual,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
    );
    const farText = buildRescueExplanation("X", 2.5, farActual, farDeviations);
    expect(farText).not.toContain("sehr nah an deinen verbleibenden Zielen");
  });

  it("nennt bei einer schlechten Annäherung genau den Makro mit der größten tatsächlichen Abweichung", () => {
    // Protein weicht am stärksten ab (10 statt 55 = ~82%), Kalorien nur leicht.
    const actual = { calories: 700, protein: 10, carbs: 60, fat: 18 };
    const { deviations } = computeMacroLoss(
      { calories: 650, protein: 55, carbs: 60, fat: 18 },
      actual,
      DEFAULT_MACRO_TOLERANCES,
      DEFAULT_MACRO_LOSS_WEIGHTS,
    );
    const text = buildRescueExplanation("X", 1, actual, deviations);
    expect(text).toContain("Protein");
  });

  describe("formatiert Portionsangaben korrekt", () => {
    it("spricht bei ~1 von 'einer Portion'", () => {
      const actual = { calories: 650, protein: 55, carbs: 60, fat: 18 };
      const { deviations } = computeMacroLoss({ calories: 650, protein: 55, carbs: 60, fat: 18 }, actual, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
      expect(buildRescueExplanation("X", 1, actual, deviations)).toContain("einer Portion");
    });
  });
});
