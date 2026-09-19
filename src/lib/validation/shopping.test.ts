import { describe, expect, it } from "vitest";
import { weeklyShoppingQuerySchema } from "./shopping";

describe("weeklyShoppingQuerySchema", () => {
  it("akzeptiert eine fehlende Angabe (aktuelle Woche)", () => {
    const result = weeklyShoppingQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.date).toBeUndefined();
  });

  it("liest JJJJ-MM-TT als lokales Datum", () => {
    const result = weeklyShoppingQuerySchema.safeParse({ date: "2026-09-23" });
    expect(result.data?.date).toEqual(new Date(2026, 8, 23));
  });

  it("lehnt falsche Formate und nicht existierende Tage ab", () => {
    for (const date of ["", "23.09.2026", "2026-9-23", "2026-13-01", "2026-02-30", "heute"]) {
      expect(weeklyShoppingQuerySchema.safeParse({ date }).success).toBe(false);
    }
  });
});
