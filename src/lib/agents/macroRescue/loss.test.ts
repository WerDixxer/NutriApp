import { describe, expect, it } from "vitest";
import { computeMacroLoss, type MacroActualInput, type MacroTargetsInput } from "./loss";
import { DEFAULT_MACRO_LOSS_WEIGHTS } from "./lossWeights";
import { DEFAULT_MACRO_TOLERANCES } from "./tolerances";

const targets: MacroTargetsInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };

describe("computeMacroLoss", () => {
  it("liefert 0 Loss bei einem exakten Treffer über alle Makros", () => {
    const actual: MacroActualInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const { totalLoss } = computeMacroLoss(targets, actual, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(totalLoss).toBe(0);
  });

  it("bleibt bei 0 Loss innerhalb der konfigurierten Toleranz, auch ohne exakten Treffer", () => {
    // 5% über dem Kalorienziel, Toleranz ist ±10%.
    const actual: MacroActualInput = { calories: 682.5, protein: 55, carbs: 60, fat: 18 };
    const { totalLoss, deviations } = computeMacroLoss(targets, actual, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(totalLoss).toBe(0);
    expect(deviations.find((d) => d.macro === "calories")?.withinTolerance).toBe(true);
  });

  it("berücksichtigt Kalorien, Protein, Carbs und Fett gemeinsam, nicht nur Kalorien", () => {
    // Exakte Kalorien, aber Protein/Carbs/Fett weit daneben.
    const badMacros: MacroActualInput = { calories: 650, protein: 5, carbs: 200, fat: 80 };
    const good: MacroActualInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const badLoss = computeMacroLoss(targets, badMacros, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS).totalLoss;
    const goodLoss = computeMacroLoss(targets, good, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS).totalLoss;
    expect(badLoss).toBeGreaterThan(goodLoss);
    expect(badLoss).toBeGreaterThan(0);
  });

  it("respektiert konfigurierbare Toleranzen: engere Toleranz erzeugt Loss, wo die Standard-Toleranz noch 0 ergibt", () => {
    const actual: MacroActualInput = { calories: 682.5, protein: 55, carbs: 60, fat: 18 }; // 5% über dem Ziel
    const wideTolerance = computeMacroLoss(
      targets,
      actual,
      { ...DEFAULT_MACRO_TOLERANCES, caloriesPct: 0.1 },
      DEFAULT_MACRO_LOSS_WEIGHTS,
    ).totalLoss;
    const narrowTolerance = computeMacroLoss(
      targets,
      actual,
      { ...DEFAULT_MACRO_TOLERANCES, caloriesPct: 0.02 },
      DEFAULT_MACRO_LOSS_WEIGHTS,
    ).totalLoss;
    expect(wideTolerance).toBe(0);
    expect(narrowTolerance).toBeGreaterThan(0);
  });

  it("interpretiert fehlende Werte niemals als 0, sondern markiert den Makro als nicht bewertet", () => {
    const actual: MacroActualInput = { calories: 650, protein: 55, carbs: 60, fat: 18 }; // kein fiber
    const { deviations } = computeMacroLoss(targets, actual, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    const fiber = deviations.find((d) => d.macro === "fiber")!;
    expect(fiber.included).toBe(false);
    expect(fiber.loss).toBe(0);
  });

  it("bewertet einen fehlenden Zielwert (kein fiber-Ziel gesetzt) ebenfalls als nicht bewertet, nicht als Treffer", () => {
    const targetsNoFiber: MacroTargetsInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const actualWithFiber: MacroActualInput = { calories: 650, protein: 55, carbs: 60, fat: 18, fiber: 12 };
    const { deviations } = computeMacroLoss(targetsNoFiber, actualWithFiber, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(deviations.find((d) => d.macro === "fiber")?.included).toBe(false);
  });

  it("wächst der Loss monoton mit der Abweichung außerhalb der Toleranz", () => {
    const near = computeMacroLoss(targets, { ...targets, calories: 800 }, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS).totalLoss;
    const far = computeMacroLoss(targets, { ...targets, calories: 1500 }, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS).totalLoss;
    expect(far).toBeGreaterThan(near);
  });
});
