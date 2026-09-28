import { describe, expect, it } from "vitest";
import {
  storedDietTypeListSchema,
  storedImportIngredientListSchema,
  storedMealSlotListSchema,
  storedStringListSchema,
  storedUnitGramsSchema,
} from "./jsonColumnSchemas";

describe("storedStringListSchema", () => {
  it("akzeptiert Listen aus Strings, auch leere Einträge älterer Datensätze", () => {
    expect(storedStringListSchema.parse(["100 g Reis", ""])).toEqual(["100 g Reis", ""]);
    expect(storedStringListSchema.parse([])).toEqual([]);
  });

  it.each([
    ["ein Objekt", { a: 1 }],
    ["einen String", "Reis"],
    ["eine Liste mit Zahl", ["Reis", 3]],
    ["null", null],
  ])("lehnt %s ab", (_label, value) => {
    expect(storedStringListSchema.safeParse(value).success).toBe(false);
  });
});

describe("storedMealSlotListSchema / storedDietTypeListSchema", () => {
  it("akzeptiert die bekannten Enum-Werte", () => {
    expect(storedMealSlotListSchema.parse(["LUNCH", "POST_WORKOUT"])).toEqual(["LUNCH", "POST_WORKOUT"]);
    expect(storedDietTypeListSchema.parse(["OMNIVORE", "VEGAN"])).toEqual(["OMNIVORE", "VEGAN"]);
  });

  it("lehnt unbekannte oder falsch geschriebene Werte ab", () => {
    expect(storedMealSlotListSchema.safeParse(["lunch"]).success).toBe(false);
    expect(storedMealSlotListSchema.safeParse(["BRUNCH"]).success).toBe(false);
    expect(storedDietTypeListSchema.safeParse(["CARNIVORE"]).success).toBe(false);
  });
});

describe("storedUnitGramsSchema", () => {
  it("akzeptiert Gramm je bekannter Einheit", () => {
    expect(storedUnitGramsSchema.parse({ ml: 1.03, piece: 55 })).toEqual({ ml: 1.03, piece: 55 });
  });

  it("behält unbekannte Einheiten, statt sie still zu entfernen", () => {
    expect(storedUnitGramsSchema.parse({ ml: 1, cup: 240 })).toEqual({ ml: 1, cup: 240 });
  });

  it("lehnt nicht-numerische Werte und Nicht-Objekte ab", () => {
    expect(storedUnitGramsSchema.safeParse({ ml: "1.03" }).success).toBe(false);
    expect(storedUnitGramsSchema.safeParse([55]).success).toBe(false);
  });
});

describe("storedImportIngredientListSchema", () => {
  const ingredient = {
    originalText: "200 g Skyr",
    normalizedLabel: "skyr",
    amount: 200,
    unit: "g",
    optional: false,
    resolutionStatus: "resolved",
    resolvedFoodId: "skyr",
    resolvedFoodName: "Skyr",
    manualAssignment: null,
  };

  it("akzeptiert eine gespeicherte Zutat, auch mit manueller Zuordnung", () => {
    const assigned = { ...ingredient, manualAssignment: { assignedAt: "2026-09-01T10:00:00.000Z", actorUserId: null } };
    expect(storedImportIngredientListSchema.parse([ingredient, assigned])).toEqual([ingredient, assigned]);
  });

  it("lehnt fehlende Pflichtfelder ab", () => {
    for (const field of ["originalText", "resolutionStatus", "manualAssignment"]) {
      const incomplete: Record<string, unknown> = { ...ingredient };
      delete incomplete[field];
      expect(storedImportIngredientListSchema.safeParse([incomplete]).success, field).toBe(false);
    }
  });

  it("lehnt inkompatible Werte ab (unbekannte Einheit, Status, Mengentyp)", () => {
    expect(storedImportIngredientListSchema.safeParse([{ ...ingredient, unit: "cup" }]).success).toBe(false);
    expect(storedImportIngredientListSchema.safeParse([{ ...ingredient, resolutionStatus: "maybe" }]).success).toBe(false);
    expect(storedImportIngredientListSchema.safeParse([{ ...ingredient, amount: "200" }]).success).toBe(false);
  });

  it("behält zusätzliche Felder, weil die Spalte beim Food-Zuordnen wieder geschrieben wird", () => {
    const withExtra = { ...ingredient, sourceHint: "Zeile 3" };
    expect(storedImportIngredientListSchema.parse([withExtra])).toEqual([withExtra]);
  });
});
