import { describe, expect, it } from "vitest";
import { generateMealPlanSchema, updateMealPlanSchema } from "./mealPlan";

describe("generateMealPlanSchema", () => {
  it("akzeptiert eine minimale gültige Eingabe", () => {
    const result = generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 7, mealTypes: ["BREAKFAST", "LUNCH", "DINNER"] });
    expect(result.success).toBe(true);
  });

  it("lehnt 0 Tage ab", () => {
    expect(generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 0, mealTypes: ["LUNCH"] }).success).toBe(false);
  });

  it("lehnt mehr als 14 Tage ab", () => {
    expect(generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 15, mealTypes: ["LUNCH"] }).success).toBe(false);
  });

  it("lehnt eine leere mealTypes-Liste ab", () => {
    expect(generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 7, mealTypes: [] }).success).toBe(false);
  });

  it("lehnt einen ungültigen Mahlzeiten-Typ ab (z.B. PRE_WORKOUT, das der Haushalts-Planer nicht unterstützt)", () => {
    const result = generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 7, mealTypes: ["PRE_WORKOUT"] });
    expect(result.success).toBe(false);
  });

  it("erlaubt memberIds wegzulassen", () => {
    const result = generateMealPlanSchema.safeParse({ startDate: "2026-09-21", days: 1, mealTypes: ["LUNCH"] });
    expect(result.success).toBe(true);
  });

  it("liest startDate als Kalendertag, nicht als Zeitpunkt (F-10)", () => {
    const result = generateMealPlanSchema.parse({ startDate: "2026-09-21", days: 1, mealTypes: ["LUNCH"] });
    expect(result.startDate).toBe("2026-09-21");
  });

  it("lehnt Zeitpunkte und nicht existierende Tage als startDate ab", () => {
    for (const startDate of ["2026-09-21T08:00:00Z", "2026-02-30", "21.09.2026"]) {
      expect(generateMealPlanSchema.safeParse({ startDate, days: 1, mealTypes: ["LUNCH"] }).success).toBe(false);
    }
  });
});

describe("updateMealPlanSchema", () => {
  it("akzeptiert nur status", () => {
    expect(updateMealPlanSchema.safeParse({ status: "ARCHIVED" }).success).toBe(true);
  });

  it("lehnt einen ungültigen status ab", () => {
    expect(updateMealPlanSchema.safeParse({ status: "DELETED" }).success).toBe(false);
  });

  it("akzeptiert ein leeres Objekt (nichts zu ändern)", () => {
    expect(updateMealPlanSchema.safeParse({}).success).toBe(true);
  });
});
