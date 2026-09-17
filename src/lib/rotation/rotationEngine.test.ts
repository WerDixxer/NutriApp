import { describe, expect, it } from "vitest";
import { computeRotationResult, groupRotationResultsForDisplay, prioritizePantryItems } from "./rotationEngine";
import type { RotationItemInput } from "./types";

const now = new Date("2026-09-17T12:00:00Z");

function item(overrides: Partial<RotationItemInput> = {}): RotationItemInput {
  return {
    id: "item-1",
    name: "Testprodukt",
    opened: false,
    cooked: false,
    quantity: 500,
    remainingQuantity: 500,
    expirationDate: null,
    expirationDateType: "UNKNOWN",
    purchaseDate: null,
    location: "OTHER",
    ...overrides,
  };
}

describe("computeRotationResult: Safety/Uncertainty", () => {
  it("gibt urgency UNKNOWN für ein Item ganz ohne Signale (kein erfundener 'unauffällig'-Status)", () => {
    const result = computeRotationResult(item(), now);
    expect(result.urgency).toBe("UNKNOWN");
    expect(result.recommendedAction).toBe("NO_ACTION");
    expect(result.priorityScore).toBe(0);
  });

  it("behandelt ein ESTIMATED-Datum milder als EXACT, ohne die Unsicherheit zu verschleiern", () => {
    const exact = computeRotationResult(item({ expirationDate: now, expirationDateType: "EXACT" }), now);
    const estimated = computeRotationResult(item({ expirationDate: now, expirationDateType: "ESTIMATED" }), now);
    expect(estimated.priorityScore).toBeLessThan(exact.priorityScore);
    expect(estimated.reasons[0]).toContain("geschätzt");
  });

  it("erfindet niemals ein Ablaufdatum bei UNKNOWN: keine expiration-bezogenen reasons/warnings", () => {
    const result = computeRotationResult(item({ opened: true }), now);
    expect(result.reasons.some((r) => r.toLowerCase().includes("ablauf"))).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("erzwingt bei einem abgelaufenen Item immer recommendedAction CHECK, nie USE_FIRST", () => {
    const result = computeRotationResult(
      { ...item(), opened: true, cooked: true, expirationDate: new Date("2026-09-01"), expirationDateType: "EXACT" },
      now,
    );
    expect(result.recommendedAction).toBe("CHECK");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).not.toMatch(/sicher essbar|noch gut|unbedenklich|genießbar/i);
  });
});

describe("computeRotationResult: einzelne Ablauf-Stufen", () => {
  it("expired", () => {
    const result = computeRotationResult(item({ expirationDate: new Date("2026-09-01"), expirationDateType: "EXACT" }), now);
    expect(result.urgency).toBe("CRITICAL");
  });

  it("expires today", () => {
    const result = computeRotationResult(item({ expirationDate: now, expirationDateType: "EXACT" }), now);
    expect(["CRITICAL", "HIGH"]).toContain(result.urgency);
  });

  it("expires soon (wenige Tage)", () => {
    const result = computeRotationResult(item({ expirationDate: new Date("2026-09-19"), expirationDateType: "EXACT" }), now);
    expect(["HIGH", "MEDIUM"]).toContain(result.urgency);
  });

  it("expires later (innerhalb einer Woche) liegt niedriger als 'wenige Tage'", () => {
    const week = computeRotationResult(item({ expirationDate: new Date("2026-09-22"), expirationDateType: "EXACT" }), now);
    const fewDays = computeRotationResult(item({ expirationDate: new Date("2026-09-19"), expirationDateType: "EXACT" }), now);
    expect(week.priorityScore).toBeLessThan(fewDays.priorityScore);
  });

  it("unknown expiration ergibt keinen Ablauf-Beitrag zum Score", () => {
    const result = computeRotationResult(item(), now);
    expect(result.priorityScore).toBe(0);
  });
});

describe("computeRotationResult: opened vs unopened, cooked vs uncooked", () => {
  it("ein geöffnetes Item wird höher priorisiert als ein sonst identisches ungeöffnetes", () => {
    const opened = computeRotationResult(item({ opened: true }), now);
    const unopened = computeRotationResult(item(), now);
    expect(opened.priorityScore).toBeGreaterThan(unopened.priorityScore);
  });

  it("ein gekochtes Item wird höher priorisiert als ein sonst identisches ungekochtes", () => {
    const cooked = computeRotationResult(item({ cooked: true }), now);
    const uncooked = computeRotationResult(item(), now);
    expect(cooked.priorityScore).toBeGreaterThan(uncooked.priorityScore);
  });
});

describe("computeRotationResult: kleine Restmenge + purchaseDate", () => {
  it("small leftover quantity erhöht die Priorität", () => {
    const small = computeRotationResult(item({ quantity: 400, remainingQuantity: 80 }), now);
    const full = computeRotationResult(item({ quantity: 400, remainingQuantity: 400 }), now);
    expect(small.priorityScore).toBeGreaterThan(full.priorityScore);
  });

  it("purchase date (lange vorhanden) erhöht die Priorität leicht", () => {
    const old = computeRotationResult(item({ purchaseDate: new Date("2026-08-01") }), now);
    const fresh = computeRotationResult(item({ purchaseDate: new Date("2026-09-16") }), now);
    expect(old.priorityScore).toBeGreaterThan(fresh.priorityScore);
  });

  it("missing purchase date verursacht keinen Fehler und trägt 0 bei", () => {
    expect(() => computeRotationResult(item({ purchaseDate: null }), now)).not.toThrow();
  });
});

describe("computeRotationResult: mehrere Faktoren gleichzeitig", () => {
  it("kombiniert geöffnet + kleine Restmenge + Ablauf in wenigen Tagen zu USE_FIRST/hoher Dringlichkeit", () => {
    const result = computeRotationResult(
      {
        ...item(),
        opened: true,
        quantity: 400,
        remainingQuantity: 80,
        expirationDate: new Date("2026-09-19"),
        expirationDateType: "EXACT",
      },
      now,
    );
    expect(["CRITICAL", "HIGH"]).toContain(result.urgency);
    expect(result.recommendedAction).toBe("USE_FIRST");
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

describe("prioritizePantryItems: Determinismus", () => {
  it("liefert bei gleicher Eingabe immer dasselbe Ergebnis", () => {
    const items = [item({ id: "a", opened: true }), item({ id: "b" }), item({ id: "c", cooked: true })];
    const run1 = prioritizePantryItems(items, now).map((r) => r.pantryItemId);
    const run2 = prioritizePantryItems(items, now).map((r) => r.pantryItemId);
    expect(run1).toEqual(run2);
  });

  it("bricht einen exakten Score-Gleichstand deterministisch über die pantryItemId", () => {
    const items = [item({ id: "z" }), item({ id: "a" }), item({ id: "m" })];
    const results = prioritizePantryItems(items, now);
    expect(results.map((r) => r.pantryItemId)).toEqual(["a", "m", "z"]);
  });

  it("sortiert absteigend nach priorityScore", () => {
    const items = [item({ id: "low" }), item({ id: "high", expirationDate: new Date("2026-09-01"), expirationDateType: "EXACT" })];
    const results = prioritizePantryItems(items, now);
    expect(results[0].pantryItemId).toBe("high");
  });

  it("funktioniert korrekt mit nur einem Item", () => {
    const results = prioritizePantryItems([item({ id: "only" })], now);
    expect(results).toHaveLength(1);
  });

  it("funktioniert korrekt mit einer leeren Pantry", () => {
    expect(prioritizePantryItems([], now)).toEqual([]);
  });

  it("verarbeitet viele Items mit gemischter Dringlichkeit ohne Fehler", () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ id: `item-${i}`, opened: i % 3 === 0, cooked: i % 5 === 0, expirationDate: i % 4 === 0 ? new Date("2026-09-18") : null, expirationDateType: i % 4 === 0 ? "EXACT" : "UNKNOWN" }),
    );
    const results = prioritizePantryItems(items, now);
    expect(results).toHaveLength(20);
    const urgencies = new Set(results.map((r) => r.urgency));
    expect(urgencies.size).toBeGreaterThan(1);
  });
});

describe("groupRotationResultsForDisplay", () => {
  it("gruppiert USE_FIRST/USE_SOON/CHECK unter useFirst und PLAN_MEAL unter planMeal", () => {
    const results = prioritizePantryItems(
      [
        item({ id: "urgent", opened: true, quantity: 400, remainingQuantity: 80, expirationDate: new Date("2026-09-18"), expirationDateType: "EXACT" }),
        item({ id: "medium", expirationDate: new Date("2026-09-22"), expirationDateType: "EXACT" }),
        item({ id: "keep", purchaseDate: new Date("2026-09-16") }),
      ],
      now,
    );
    const { useFirst, planMeal } = groupRotationResultsForDisplay(results);
    expect(useFirst.some((r) => r.pantryItemId === "urgent")).toBe(true);
    expect(planMeal.some((r) => r.pantryItemId === "medium")).toBe(true);
    expect(useFirst.some((r) => r.pantryItemId === "keep")).toBe(false);
    expect(planMeal.some((r) => r.pantryItemId === "keep")).toBe(false);
  });
});
