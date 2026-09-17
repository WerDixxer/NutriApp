import { describe, expect, it } from "vitest";
import { getExpirationStatus } from "../pantry/expiration";
import { scoreAge, scoreExpiration, scoreLocation, scoreOpenedCooked, scoreRemainingQuantity } from "./factors";
import type { RotationItemInput } from "./types";
import { ROTATION_WEIGHTS } from "./weights";

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

describe("scoreExpiration", () => {
  it("gibt 0 Punkte ohne erfundenes Signal, wenn kein Ablaufdatum bekannt ist (UNKNOWN)", () => {
    const i = item();
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(0);
    expect(result.reason).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  it("erkennt ein abgelaufenes Item, stellt aber nur EXPIRED fest und trifft keine Genusstauglichkeits-Aussage", () => {
    const i = item({ expirationDate: new Date("2026-09-10"), expirationDateType: "EXACT" });
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(ROTATION_WEIGHTS.expiredPoints);
    expect(result.warning).toBeDefined();
    expect(result.warning).not.toMatch(/sicher essbar|noch gut|unbedenklich/i);
  });

  it("erkennt 'läuft heute ab'", () => {
    const i = item({ expirationDate: now, expirationDateType: "EXACT" });
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(ROTATION_WEIGHTS.expiresTodayPoints);
    expect(result.reason).toMatch(/heute/);
  });

  it("erkennt 'läuft in wenigen Tagen ab' (1-2 Tage)", () => {
    const i = item({ expirationDate: new Date("2026-09-19"), expirationDateType: "EXACT" });
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(ROTATION_WEIGHTS.expiresFewDaysPoints);
  });

  it("erkennt 'läuft innerhalb einer Woche ab' (3-7 Tage)", () => {
    const i = item({ expirationDate: new Date("2026-09-22"), expirationDateType: "EXACT" });
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(ROTATION_WEIGHTS.expiresWeekPoints);
  });

  it("gibt ein späteres Ablaufdatum nur einen milden Punktwert", () => {
    const i = item({ expirationDate: new Date("2026-12-01"), expirationDateType: "EXACT" });
    const result = scoreExpiration(i, getExpirationStatus(i.expirationDate, now));
    expect(result.points).toBe(ROTATION_WEIGHTS.expiresLaterPoints);
  });

  it("gewichtet ESTIMATED weniger hart als EXACT für dasselbe Datum", () => {
    const exact = item({ expirationDate: now, expirationDateType: "EXACT" });
    const estimated = item({ expirationDate: now, expirationDateType: "ESTIMATED" });
    const exactResult = scoreExpiration(exact, getExpirationStatus(exact.expirationDate, now));
    const estimatedResult = scoreExpiration(estimated, getExpirationStatus(estimated.expirationDate, now));
    expect(estimatedResult.points).toBeLessThan(exactResult.points);
    expect(estimatedResult.points).toBeCloseTo(exactResult.points * ROTATION_WEIGHTS.estimatedMultiplier, 5);
  });
});

describe("scoreOpenedCooked", () => {
  it("gibt keine Faktoren zurück, wenn weder geöffnet noch gekocht", () => {
    expect(scoreOpenedCooked(item())).toHaveLength(0);
  });

  it("erkennt geöffnet", () => {
    const results = scoreOpenedCooked(item({ opened: true }));
    expect(results.find((r) => r.factor === "opened")?.points).toBe(ROTATION_WEIGHTS.openedPoints);
  });

  it("erkennt gekocht und gewichtet es stärker als nur geöffnet", () => {
    const cooked = scoreOpenedCooked(item({ cooked: true })).find((r) => r.factor === "cooked");
    expect(cooked?.points).toBe(ROTATION_WEIGHTS.cookedPoints);
    expect(ROTATION_WEIGHTS.cookedPoints).toBeGreaterThan(ROTATION_WEIGHTS.openedPoints);
  });

  it("erkennt beides gleichzeitig als zwei getrennte Faktoren", () => {
    const results = scoreOpenedCooked(item({ opened: true, cooked: true }));
    expect(results).toHaveLength(2);
  });
});

describe("Opened darf ein unmittelbar ablaufendes, ungeöffnetes Produkt nicht überstimmen", () => {
  it("bleibt openedPoints unter jedem Ablauf-Tier ab 'läuft in wenigen Tagen ab'", () => {
    expect(ROTATION_WEIGHTS.openedPoints).toBeLessThan(ROTATION_WEIGHTS.expiresFewDaysPoints);
    expect(ROTATION_WEIGHTS.openedPoints).toBeLessThan(ROTATION_WEIGHTS.expiresTodayPoints);
    expect(ROTATION_WEIGHTS.openedPoints).toBeLessThan(ROTATION_WEIGHTS.expiredPoints);
  });
});

describe("scoreRemainingQuantity", () => {
  it("erkennt eine kleine Restmenge (<=25% der ursprünglichen Menge)", () => {
    const result = scoreRemainingQuantity(item({ quantity: 400, remainingQuantity: 80 }));
    expect(result.points).toBe(ROTATION_WEIGHTS.smallRemainingPoints);
    expect(result.reason).toBeDefined();
  });

  it("gibt 0 Punkte für eine normale Restmenge", () => {
    const result = scoreRemainingQuantity(item({ quantity: 400, remainingQuantity: 350 }));
    expect(result.points).toBe(0);
  });

  it("erfindet keine Umrechnung, vergleicht nur innerhalb derselben Einheit", () => {
    // 80/400 = 20%, unabhängig von der Einheit selbst, keine Konvertierung nötig.
    const result = scoreRemainingQuantity(item({ quantity: 400, remainingQuantity: 80 }));
    expect(result.points).toBeGreaterThan(0);
  });

  it("gibt 0 Punkte, wenn die Restmenge bereits 0 ist (kein Signal, kein Fehler)", () => {
    const result = scoreRemainingQuantity(item({ quantity: 400, remainingQuantity: 0 }));
    expect(result.points).toBe(0);
  });
});

describe("scoreAge", () => {
  it("gibt 0 Punkte ohne purchaseDate", () => {
    expect(scoreAge(item(), now).points).toBe(0);
  });

  it("erkennt ein lange vorhandenes Item (>= 14 Tage)", () => {
    const result = scoreAge(item({ purchaseDate: new Date("2026-09-01") }), now);
    expect(result.points).toBe(ROTATION_WEIGHTS.longPresentPoints);
  });

  it("gibt 0 Punkte für ein kürzlich gekauftes Item", () => {
    const result = scoreAge(item({ purchaseDate: new Date("2026-09-16") }), now);
    expect(result.points).toBe(0);
  });

  it("ersetzt niemals ein fehlendes Ablaufdatum: age allein löst kein EXPIRED/Ablauf-Signal aus", () => {
    const result = scoreAge(item({ purchaseDate: new Date("2026-01-01") }), now);
    expect(result.factor).toBe("age");
    expect(result.warning).toBeUndefined();
  });
});

describe("scoreLocation", () => {
  it("gibt einen milden Bonus für ein geöffnetes Kühlschrank-Item, ohne Reason-Text (keine Sicherheitsbehauptung)", () => {
    const result = scoreLocation(item({ location: "FRIDGE", opened: true }));
    expect(result.points).toBe(ROTATION_WEIGHTS.fridgeOpenedBonusPoints);
    expect(result.reason).toBeUndefined();
    expect(result.warning).toBeUndefined();
  });

  it("gibt 0 Punkte für ein ungeöffnetes Kühlschrank-Item", () => {
    expect(scoreLocation(item({ location: "FRIDGE", opened: false })).points).toBe(0);
  });

  it("gibt 0 Punkte für andere Lagerorte", () => {
    expect(scoreLocation(item({ location: "PANTRY", opened: true })).points).toBe(0);
  });
});
