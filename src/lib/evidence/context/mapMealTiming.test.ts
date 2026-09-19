import { describe, expect, it } from "vitest";
import type { MealSlot } from "@prisma/client";
import { mapMealLogToEvidenceContext, mapMealSlotToTimingContext } from "./mapMealTiming";

describe("mapMealSlotToTimingContext: exhaustiv für jeden MealSlot-Wert", () => {
  const expected: Record<MealSlot, string | undefined> = {
    PRE_WORKOUT: "pre-exercise",
    POST_WORKOUT: "post-exercise",
    BREAKFAST: undefined,
    LUNCH: undefined,
    DINNER: undefined,
    SNACK: undefined,
  };

  for (const [slot, expectedValue] of Object.entries(expected) as [MealSlot, string | undefined][]) {
    it(`${slot} -> ${expectedValue ?? "undefined"}`, () => {
      expect(mapMealSlotToTimingContext(slot)).toBe(expectedValue);
    });
  }

  it("liefert für reguläre Mahlzeiten-Slots (BREAKFAST/LUNCH/DINNER/SNACK) explizit undefined", () => {
    expect(mapMealSlotToTimingContext("BREAKFAST")).toBeUndefined();
    expect(mapMealSlotToTimingContext("LUNCH")).toBeUndefined();
    expect(mapMealSlotToTimingContext("DINNER")).toBeUndefined();
    expect(mapMealSlotToTimingContext("SNACK")).toBeUndefined();
  });
});

describe("mapMealLogToEvidenceContext", () => {
  it("setzt timingContext für PRE_WORKOUT", () => {
    expect(mapMealLogToEvidenceContext({ slot: "PRE_WORKOUT" })).toEqual({ timingContext: "pre-exercise" });
  });

  it("setzt timingContext für POST_WORKOUT", () => {
    expect(mapMealLogToEvidenceContext({ slot: "POST_WORKOUT" })).toEqual({ timingContext: "post-exercise" });
  });

  it("liefert einen leeren Kontext für BREAKFAST (kein erfundener 'daily_intake'-Wert)", () => {
    expect(mapMealLogToEvidenceContext({ slot: "BREAKFAST" })).toEqual({});
  });

  it("liefert KEINE Empfehlung, nur einen Zustand (keine Zeit-/Minutenangabe im Ergebnis)", () => {
    const context = mapMealLogToEvidenceContext({ slot: "POST_WORKOUT" });
    expect(context).not.toHaveProperty("recommendation");
    expect(Object.keys(context)).toEqual(["timingContext"]);
  });

  it("Determinismus: identischer Input liefert exakt denselben EvidenceContext", () => {
    const input = { slot: "PRE_WORKOUT" as const };
    expect(mapMealLogToEvidenceContext(input)).toEqual(mapMealLogToEvidenceContext(input));
  });
});
