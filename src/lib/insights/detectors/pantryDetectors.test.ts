import { describe, expect, it } from "vitest";
import { detectPantryExpired, detectPantryExpiringSoon, type PantryInsightItem } from "./pantryDetectors";

const now = new Date("2026-09-18T12:00:00Z");

function item(overrides: Partial<PantryInsightItem> = {}): PantryInsightItem {
  return {
    id: "item-1",
    name: "Paprika",
    remainingQuantity: 3,
    expirationDate: null,
    ...overrides,
  };
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

describe("detectPantryExpiringSoon", () => {
  it("meldet ein Item, das heute abläuft, mit Priorität critical", () => {
    const insights = detectPantryExpiringSoon([item({ expirationDate: now })], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("critical");
    expect(insights[0].message).toContain("Paprika");
    expect(insights[0].message).toContain("heute");
  });

  it("meldet ein Item, das morgen abläuft, mit Priorität important", () => {
    const insights = detectPantryExpiringSoon([item({ expirationDate: addDays(now, 1) })], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("important");
    expect(insights[0].message).toContain("morgen");
  });

  it("meldet NICHTS für ein Item mit ausreichender Resthaltbarkeit (5 Tage)", () => {
    const insights = detectPantryExpiringSoon([item({ expirationDate: addDays(now, 5) })], now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für ein bereits vollständig aufgebrauchtes Item", () => {
    const insights = detectPantryExpiringSoon([item({ expirationDate: now, remainingQuantity: 0 })], now);
    expect(insights).toHaveLength(0);
  });

  it("erzeugt für 'morgen' und 'heute' unterschiedliche ids (Dringlichkeit darf trotz alter Ablehnung zunehmen)", () => {
    const expiresOn = addDays(now, 1);
    const tomorrow = detectPantryExpiringSoon([item({ id: "x", expirationDate: expiresOn })], now);
    const today = detectPantryExpiringSoon([item({ id: "x", expirationDate: expiresOn })], addDays(now, 1));
    expect(tomorrow[0].id).not.toBe(today[0].id);
  });

  it("liefert dieselbe id bei wiederholtem Aufruf mit gleichbleibenden Daten (Dedupe-Grundlage)", () => {
    const first = detectPantryExpiringSoon([item({ expirationDate: now })], now);
    const second = detectPantryExpiringSoon([item({ expirationDate: now })], now);
    expect(first[0].id).toBe(second[0].id);
  });
});

describe("detectPantryExpired", () => {
  it("meldet ein überfälliges Item als critical", () => {
    const insights = detectPantryExpired([item({ expirationDate: addDays(now, -3) })], now);
    expect(insights).toHaveLength(1);
    expect(insights[0].priority).toBe("critical");
    expect(insights[0].message).toContain("3 Tagen");
  });

  it("meldet NICHTS für ein Item ohne Ablaufdatum", () => {
    const insights = detectPantryExpired([item({ expirationDate: null })], now);
    expect(insights).toHaveLength(0);
  });

  it("meldet NICHTS für ein noch haltbares Item", () => {
    const insights = detectPantryExpired([item({ expirationDate: addDays(now, 2) })], now);
    expect(insights).toHaveLength(0);
  });
});
