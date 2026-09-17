import { describe, expect, it } from "vitest";
import { calcBMR, calcFullTargets, calcGoalCalories, calcMacros, calcTDEE, clampGoalRate } from "./nutrition";

describe("calcBMR", () => {
  it("matches Mifflin-St Jeor for a male", () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calcBMR("MALE", 80, 180, 30)).toBeCloseTo(1780, 5);
  });

  it("matches Mifflin-St Jeor for a female", () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    expect(calcBMR("FEMALE", 60, 165, 25)).toBeCloseTo(1345.25, 5);
  });
});

describe("calcTDEE", () => {
  it("applies the activity factor", () => {
    expect(calcTDEE(2000, "SEDENTARY")).toBeCloseTo(2400, 5);
    expect(calcTDEE(2000, "ATHLETE")).toBeCloseTo(3800, 5);
  });
});

describe("clampGoalRate", () => {
  it("caps muscle gain at 0.3 kg/week regardless of requested rate", () => {
    expect(clampGoalRate("GAIN_MUSCLE", 5)).toBe(0.3);
  });

  it("never goes negative", () => {
    expect(clampGoalRate("LOSE_WEIGHT", -2)).toBe(0);
  });

  it("passes through values already within bounds", () => {
    expect(clampGoalRate("LOSE_WEIGHT", 0.5)).toBe(0.5);
  });
});

describe("calcGoalCalories", () => {
  const tdee = 2500;

  it("never deficits more than 25% below TDEE, even at extreme requested rates", () => {
    const kcal = calcGoalCalories(tdee, "LOSE_WEIGHT", 999);
    expect(kcal).toBeGreaterThanOrEqual(Math.round(tdee * 0.75));
  });

  it("never surpluses more than 20% above TDEE for muscle gain", () => {
    const kcal = calcGoalCalories(tdee, "GAIN_MUSCLE", 999);
    expect(kcal).toBeLessThanOrEqual(Math.round(tdee * 1.2));
  });

  it("returns the TDEE unchanged for MAINTAIN", () => {
    expect(calcGoalCalories(tdee, "MAINTAIN", 0)).toBe(Math.round(tdee));
  });
});

describe("calcMacros", () => {
  it("keeps kcal from protein + fat + carbs consistent with the target", () => {
    const target = 2200;
    const macros = calcMacros(target, 80, "GAIN_MUSCLE", "STRENGTH");
    const reconstructed = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
    expect(Math.abs(reconstructed - target)).toBeLessThan(10);
  });

  it("never returns negative carbs even for very high protein/fat targets", () => {
    const macros = calcMacros(1200, 120, "LOSE_WEIGHT", "STRENGTH");
    expect(macros.carbsG).toBeGreaterThanOrEqual(0);
  });
});

describe("calcFullTargets", () => {
  it("produces internally consistent bmr <= tdee <= plausible kcal target", () => {
    const targets = calcFullTargets({
      sex: "MALE",
      weightKg: 75,
      heightCm: 178,
      age: 28,
      activityLevel: "MODERATE",
      goal: "MAINTAIN",
      goalRateKgPerWeek: 0,
      sportType: "STRENGTH",
    });
    expect(targets.bmr).toBeLessThan(targets.tdee);
    expect(targets.kcal).toBe(targets.tdee);
    expect(targets.proteinG).toBeGreaterThan(0);
  });
});
