import { describe, expect, it } from "vitest";
import { buildSlotTargets } from "./slotWeights";

const dailyTarget = { kcal: 2000, proteinG: 150, carbsG: 200, fatG: 60 };

describe("buildSlotTargets: ohne Snack", () => {
  it("erzeugt genau einen SlotTarget pro angeforderten Slot", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "DINNER"]);
    expect(slots.map((s) => s.slot)).toEqual(["BREAKFAST", "LUNCH", "DINNER"]);
  });

  it("die Summe der kcal über alle Slots entspricht (gerundet) dem Tagesziel", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "DINNER"]);
    const total = slots.reduce((sum, s) => sum + s.kcal, 0);
    expect(total).toBeGreaterThanOrEqual(dailyTarget.kcal - 3);
    expect(total).toBeLessThanOrEqual(dailyTarget.kcal + 3);
  });

  it("DINNER bekommt mehr Kalorien zugewiesen als BREAKFAST (dokumentiertes Gewicht)", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "DINNER"]);
    const breakfast = slots.find((s) => s.slot === "BREAKFAST")!;
    const dinner = slots.find((s) => s.slot === "DINNER")!;
    expect(dinner.kcal).toBeGreaterThan(breakfast.kcal);
  });
});

describe("buildSlotTargets: mit Snack", () => {
  it("erzeugt einen SNACK-Slot mit einem kleineren Anteil als die Hauptmahlzeiten", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "SNACK", "DINNER"]);
    const snack = slots.find((s) => s.slot === "SNACK")!;
    const lunch = slots.find((s) => s.slot === "LUNCH")!;
    expect(snack.kcal).toBeLessThan(lunch.kcal);
  });

  it("Summe bleibt auch mit Snack beim Tagesziel", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "SNACK", "DINNER"]);
    const total = slots.reduce((sum, s) => sum + s.kcal, 0);
    expect(total).toBeGreaterThanOrEqual(dailyTarget.kcal - 3);
    expect(total).toBeLessThanOrEqual(dailyTarget.kcal + 3);
  });
});

describe("buildSlotTargets: normalisiert auf angeforderte Teilmenge", () => {
  it("funktioniert auch mit nur zwei angeforderten Slots (z.B. nur Frühstück + Abendessen)", () => {
    const slots = buildSlotTargets(dailyTarget, ["BREAKFAST", "DINNER"]);
    const total = slots.reduce((sum, s) => sum + s.kcal, 0);
    expect(total).toBeGreaterThanOrEqual(dailyTarget.kcal - 3);
    expect(total).toBeLessThanOrEqual(dailyTarget.kcal + 3);
  });
});

describe("buildSlotTargets: Determinismus", () => {
  it("liefert bei gleicher Eingabe immer dasselbe Ergebnis", () => {
    const a = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "DINNER"]);
    const b = buildSlotTargets(dailyTarget, ["BREAKFAST", "LUNCH", "DINNER"]);
    expect(a).toEqual(b);
  });
});
