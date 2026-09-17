import { describe, expect, it } from "vitest";
import { findOptimalPortion, PORTION_BOUNDS } from "./portionOptimizer";
import { DEFAULT_MACRO_LOSS_WEIGHTS } from "./lossWeights";
import { DEFAULT_MACRO_TOLERANCES } from "./tolerances";
import type { MacroActualInput, MacroTargetsInput } from "./loss";

describe("findOptimalPortion", () => {
  it("findet realistisch eine größere Portion, wenn das Ziel über der Standardportion liegt (500/40 -> 750/60)", () => {
    const base: MacroActualInput = { calories: 500, protein: 40, carbs: 50, fat: 15 };
    const targets: MacroTargetsInput = { calories: 750, protein: 60, carbs: 75, fat: 22.5 };
    const scale = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(scale).toBeCloseTo(1.5, 1);
  });

  it("bleibt bei einer bereits exakt passenden Mahlzeit bei Portion 1", () => {
    const base: MacroActualInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const targets: MacroTargetsInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const scale = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(scale).toBeCloseTo(1, 1);
  });

  it("wächst niemals über die obere Grenze hinaus, auch bei einem riesigen Zielwert", () => {
    const base: MacroActualInput = { calories: 100, protein: 5, carbs: 10, fat: 2 };
    const targets: MacroTargetsInput = { calories: 5000, protein: 300, carbs: 500, fat: 150 };
    const scale = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(scale).toBeLessThanOrEqual(PORTION_BOUNDS.max);
  });

  it("schrumpft niemals unter die untere Grenze hinaus, auch bei einem winzigen Zielwert", () => {
    const base: MacroActualInput = { calories: 2000, protein: 150, carbs: 200, fat: 60 };
    const targets: MacroTargetsInput = { calories: 50, protein: 2, carbs: 5, fat: 1 };
    const scale = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(scale).toBeGreaterThanOrEqual(PORTION_BOUNDS.min);
  });

  it("liefert bei gleichem Input immer dasselbe Ergebnis (deterministisch)", () => {
    const base: MacroActualInput = { calories: 480, protein: 35, carbs: 55, fat: 16 };
    const targets: MacroTargetsInput = { calories: 650, protein: 55, carbs: 60, fat: 18 };
    const first = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    const second = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS);
    expect(first).toBe(second);
  });

  it("respektiert explizit übergebene, engere Grenzen", () => {
    const base: MacroActualInput = { calories: 500, protein: 40, carbs: 50, fat: 15 };
    const targets: MacroTargetsInput = { calories: 5000, protein: 400, carbs: 500, fat: 150 };
    const scale = findOptimalPortion(base, targets, DEFAULT_MACRO_TOLERANCES, DEFAULT_MACRO_LOSS_WEIGHTS, { min: 0.5, max: 1.2 });
    expect(scale).toBeLessThanOrEqual(1.2);
  });
});
