import { describe, expect, it } from "vitest";
import { getCurrentPeriodBounds } from "./period";

function findMonday(from: Date): Date {
  const d = new Date(from);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
}

describe("getCurrentPeriodBounds: WEEK", () => {
  it("beginnt immer an einem Montag und endet immer an einem Sonntag", () => {
    const { start, end } = getCurrentPeriodBounds("WEEK", new Date(2026, 8, 17));
    expect(start.getDay()).toBe(1);
    expect(end.getDay()).toBe(0);
  });

  it("start liegt auf 00:00:00.000, end auf 23:59:59.999", () => {
    const { start, end } = getCurrentPeriodBounds("WEEK", new Date(2026, 8, 17));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getMilliseconds()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it("das übergebene 'now' liegt immer innerhalb der berechneten Grenzen", () => {
    const now = new Date(2026, 8, 17, 14, 30);
    const { start, end } = getCurrentPeriodBounds("WEEK", now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("die Periode umfasst exakt 7 Tage (Montag bis Sonntag)", () => {
    const { start, end } = getCurrentPeriodBounds("WEEK", new Date(2026, 8, 17));
    const days = Math.round((end.getTime() - start.getTime() + 1) / (24 * 60 * 60 * 1000));
    expect(days).toBe(7);
  });

  it("ein Montag ist selbst der Start seiner eigenen Woche", () => {
    const monday = findMonday(new Date(2026, 8, 17));
    const { start } = getCurrentPeriodBounds("WEEK", monday);
    expect(start.getFullYear()).toBe(monday.getFullYear());
    expect(start.getMonth()).toBe(monday.getMonth());
    expect(start.getDate()).toBe(monday.getDate());
  });

  it("funktioniert korrekt, wenn die Woche über einen Monatswechsel läuft", () => {
    const { start, end } = getCurrentPeriodBounds("WEEK", new Date(2026, 8, 30));
    expect(start.getDay()).toBe(1);
    expect(end.getDay()).toBe(0);
  });

  it("funktioniert korrekt, wenn die Woche über einen Jahreswechsel läuft", () => {
    const { start, end } = getCurrentPeriodBounds("WEEK", new Date(2026, 11, 31));
    expect(start.getDay()).toBe(1);
    expect(end.getDay()).toBe(0);
  });
});

describe("getCurrentPeriodBounds: MONTH", () => {
  it("beginnt am 1. und endet am letzten Tag des Monats, 00:00 bis 23:59:59.999", () => {
    const { start, end } = getCurrentPeriodBounds("MONTH", new Date(2026, 8, 17));
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
    expect(end.getSeconds()).toBe(59);
    expect(end.getMilliseconds()).toBe(999);
  });

  it("das übergebene 'now' liegt immer innerhalb der berechneten Grenzen", () => {
    const now = new Date(2026, 8, 17, 9, 0);
    const { start, end } = getCurrentPeriodBounds("MONTH", now);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(end.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  it("kennt die korrekte Tageanzahl für einen 30-Tage-Monat (April)", () => {
    const { end } = getCurrentPeriodBounds("MONTH", new Date(2026, 3, 15));
    expect(end.getDate()).toBe(30);
  });

  it("kennt die korrekte Tageanzahl für einen 31-Tage-Monat (Dezember)", () => {
    const { end } = getCurrentPeriodBounds("MONTH", new Date(2026, 11, 15));
    expect(end.getDate()).toBe(31);
  });

  it("kennt Februar in einem Nicht-Schaltjahr (28 Tage, 2026)", () => {
    const { end } = getCurrentPeriodBounds("MONTH", new Date(2026, 1, 10));
    expect(end.getDate()).toBe(28);
  });

  it("kennt Februar in einem Schaltjahr (29 Tage, 2024)", () => {
    const { end } = getCurrentPeriodBounds("MONTH", new Date(2024, 1, 10));
    expect(end.getDate()).toBe(29);
  });

  it("bleibt innerhalb desselben Kalendermonats (kein Überlauf in den nächsten Monat)", () => {
    const { start, end } = getCurrentPeriodBounds("MONTH", new Date(2026, 8, 17));
    expect(start.getMonth()).toBe(8);
    expect(end.getMonth()).toBe(8);
  });
});
