import { afterEach, describe, expect, it } from "vitest";
import { toDbDate, type CalendarDate } from "../calendarDate";
import { getExpirationStatus } from "./expiration";

const now = new Date("2026-09-17T12:00:00Z");

describe("getExpirationStatus", () => {
  it("returns a neutral status when no date is known (UNKNOWN)", () => {
    const status = getExpirationStatus(null, now);
    expect(status).toEqual({ daysUntilExpiration: null, isExpired: false, isExpiringSoon: false });
  });

  it("flags a date in the past as expired", () => {
    const status = getExpirationStatus(new Date("2026-09-10T00:00:00Z"), now);
    expect(status.isExpired).toBe(true);
    expect(status.daysUntilExpiration).toBeLessThan(0);
  });

  it("flags a date within the next 2 days as expiring soon", () => {
    const status = getExpirationStatus(new Date("2026-09-18T00:00:00Z"), now);
    expect(status.isExpiringSoon).toBe(true);
    expect(status.isExpired).toBe(false);
  });

  it("does not flag a date far in the future as expiring soon", () => {
    const status = getExpirationStatus(new Date("2026-10-01T00:00:00Z"), now);
    expect(status.isExpiringSoon).toBe(false);
    expect(status.isExpired).toBe(false);
  });

  it("treats today as expiring soon, not expired", () => {
    const status = getExpirationStatus(new Date("2026-09-17T00:00:00Z"), now);
    expect(status.isExpired).toBe(false);
    expect(status.isExpiringSoon).toBe(true);
  });
});

describe("getExpirationStatus: Kalendertage in Europe/Berlin, unabhängig von der Server-Zeitzone (L-1)", () => {
  const originalTimeZone = process.env.TZ;
  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  /** Ein gespeichertes Ablaufdatum: Kalendertag als UTC-Mitternacht, wie es die Pantry-Validierung aus "JJJJ-MM-TT" macht. */
  const expiringOn = (day: CalendarDate) => toDbDate(day);
  const daysUntil = (day: CalendarDate, now: Date) => getExpirationStatus(expiringOn(day), now).daysUntilExpiration;

  /** Montag, 05.10.2026, 12:00 Uhr in Berlin. */
  const BERLIN_NOON = new Date("2026-10-05T12:00:00+02:00");
  /** 05.10.2026, 00:30 Uhr in Berlin - in UTC ist es noch der 04.10., 22:30. */
  const BERLIN_HALF_PAST_MIDNIGHT = new Date("2026-10-05T00:30:00+02:00");
  /** 05.10.2026, 23:30 Uhr in Berlin - in UTC 21:30, in Tokio schon der 06.10. */
  const BERLIN_LATE_EVENING = new Date("2026-10-05T23:30:00+02:00");

  const SERVER_TIME_ZONES = ["Europe/Berlin", "UTC", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];

  it.each(SERVER_TIME_ZONES)("Server-Zeitzone %s: gestern -1 (abgelaufen), heute 0, morgen 1, in fünf Tagen 5", (timeZone) => {
    process.env.TZ = timeZone;

    for (const now of [BERLIN_HALF_PAST_MIDNIGHT, BERLIN_NOON, BERLIN_LATE_EVENING]) {
      expect(getExpirationStatus(expiringOn("2026-10-04"), now)).toEqual({ daysUntilExpiration: -1, isExpired: true, isExpiringSoon: false });
      expect(getExpirationStatus(expiringOn("2026-10-05"), now)).toEqual({ daysUntilExpiration: 0, isExpired: false, isExpiringSoon: true });
      expect(getExpirationStatus(expiringOn("2026-10-06"), now)).toEqual({ daysUntilExpiration: 1, isExpired: false, isExpiringSoon: true });
      expect(getExpirationStatus(expiringOn("2026-10-10"), now)).toEqual({ daysUntilExpiration: 5, isExpired: false, isExpiringSoon: false });
    }
  });

  it.each(SERVER_TIME_ZONES)("Server-Zeitzone %s: um 00:30 Uhr in Berlin läuft ein Artikel vom 05.10. heute ab, obwohl UTC noch den 04.10. zeigt", (timeZone) => {
    process.env.TZ = timeZone;

    expect(daysUntil("2026-10-05", BERLIN_HALF_PAST_MIDNIGHT)).toBe(0);
    // Der Vortag ist dann schon abgelaufen, nicht "heute".
    expect(getExpirationStatus(expiringOn("2026-10-04"), BERLIN_HALF_PAST_MIDNIGHT).isExpired).toBe(true);
  });

  it("der Tag wechselt um Mitternacht Berliner Zeit: 23:59 noch heute, 00:00 gestern", () => {
    process.env.TZ = "UTC";

    expect(daysUntil("2026-10-05", new Date("2026-10-05T23:59:00+02:00"))).toBe(0);
    expect(daysUntil("2026-10-05", new Date("2026-10-06T00:00:00+02:00"))).toBe(-1);
  });

  it("über die Zeitumstellung (25.10.2026) zählen Kalendertage, keine 24-Stunden-Blöcke", () => {
    process.env.TZ = "America/New_York";

    expect(daysUntil("2026-10-26", new Date("2026-10-24T12:00:00+02:00"))).toBe(2);
    expect(daysUntil("2026-10-25", new Date("2026-10-25T23:30:00+01:00"))).toBe(0);
  });
});
