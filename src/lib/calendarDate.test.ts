import { afterEach, describe, expect, it } from "vitest";
import {
  ASSUMED_USER_TIME_ZONE,
  addDays,
  calendarDateInTimeZone,
  daysBetween,
  formatCalendarDate,
  fromDbDate,
  parseCalendarDate,
  startOfWeek,
  todayForUser,
  toDbDate,
  weekdayIndex,
} from "./calendarDate";

/**
 * F-10: Kalendertage (Nutzerzeit) vs. Zeitpunkte. Alle Zeitpunkte hier stehen ausdrücklich mit
 * Offset oder in UTC, damit der Test selbst nicht von der Zeitzone des Rechners abhängt.
 */

describe("todayForUser: Tagesgrenzen in Nutzerzeit (Europe/Berlin)", () => {
  it("nutzt Europe/Berlin, solange es kein Profilfeld für die Zeitzone gibt", () => {
    expect(ASSUMED_USER_TIME_ZONE).toBe("Europe/Berlin");
  });

  it("23:30 am 25.09. ist noch der 25.09., obwohl es in UTC schon 21:30 ist", () => {
    expect(todayForUser(new Date("2026-09-25T23:30:00+02:00"))).toBe("2026-09-25");
    expect(todayForUser(new Date("2026-09-25T23:59:59+02:00"))).toBe("2026-09-25");
  });

  it("00:30 am 26.09. ist schon der 26.09., obwohl es in UTC noch der 25.09. ist", () => {
    const halfPastMidnight = new Date("2026-09-26T00:30:00+02:00");
    expect(halfPastMidnight.toISOString().slice(0, 10)).toBe("2026-09-25"); // UTC-Tag
    expect(todayForUser(halfPastMidnight)).toBe("2026-09-26"); // Tag des Nutzers
    expect(todayForUser(new Date("2026-09-26T00:00:00+02:00"))).toBe("2026-09-26");
  });

  it("hält die Grenze auch an den Tagen der Zeitumstellung", () => {
    // Ende der Sommerzeit am 25.10.2026 (ab 03:00 wieder 02:00, UTC+1).
    expect(todayForUser(new Date("2026-10-25T23:30:00+01:00"))).toBe("2026-10-25");
    expect(todayForUser(new Date("2026-10-26T00:30:00+01:00"))).toBe("2026-10-26");
    // Beginn der Sommerzeit am 29.03.2026.
    expect(todayForUser(new Date("2026-03-29T00:30:00+01:00"))).toBe("2026-03-29");
    expect(todayForUser(new Date("2026-03-28T23:30:00+01:00"))).toBe("2026-03-28");
  });
});

describe("calendarDateInTimeZone: derselbe Zeitpunkt, verschiedene Kalendertage", () => {
  it.each([
    ["Europe/Berlin", "2026-09-26"], // 00:30
    ["UTC", "2026-09-25"], // 22:30
    ["America/New_York", "2026-09-25"], // 18:30
    ["Asia/Tokyo", "2026-09-26"], // 07:30
  ])("22:30 UTC am 25.09. ist in %s der %s", (timeZone, expected) => {
    expect(calendarDateInTimeZone(new Date("2026-09-25T22:30:00Z"), timeZone)).toBe(expected);
  });

  it.each([
    ["Europe/Berlin", "2026-09-25"], // 17:30
    ["UTC", "2026-09-25"], // 15:30
    ["America/New_York", "2026-09-25"], // 11:30
    ["Asia/Tokyo", "2026-09-26"], // 00:30
  ])("15:30 UTC am 25.09. ist in %s der %s", (timeZone, expected) => {
    expect(calendarDateInTimeZone(new Date("2026-09-25T15:30:00Z"), timeZone)).toBe(expected);
  });
});

describe("Rechnen mit Kalendertagen", () => {
  it("addDays über Monats-, Jahres-, Schaltjahr- und Zeitumstellungsgrenzen", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-30", -2)).toBe("2026-03-28");
  });

  it("daysBetween zählt Kalendertage, auch über die Zeitumstellung", () => {
    expect(daysBetween("2026-09-25", "2026-09-25")).toBe(0);
    expect(daysBetween("2026-09-25", "2026-09-28")).toBe(3);
    expect(daysBetween("2026-09-28", "2026-09-25")).toBe(-3);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  it("weekdayIndex und startOfWeek: Montag = 0, Woche Montag bis Sonntag", () => {
    expect(weekdayIndex("2026-09-21")).toBe(0); // Montag
    expect(weekdayIndex("2026-09-27")).toBe(6); // Sonntag
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(startOfWeek("2026-09-28")).toBe("2026-09-28");
    expect(startOfWeek("2026-10-01")).toBe("2026-09-28");
  });

  it("die Woche wechselt um Mitternacht Nutzerzeit, nicht um Mitternacht UTC", () => {
    const sundayLate = new Date("2026-09-27T23:30:00+02:00");
    const mondayEarly = new Date("2026-09-28T00:30:00+02:00"); // in UTC noch Sonntag, 22:30
    expect(startOfWeek(todayForUser(sundayLate))).toBe("2026-09-21");
    expect(startOfWeek(todayForUser(mondayEarly))).toBe("2026-09-28");
  });
});

describe("DB-Darstellung und Eingaben", () => {
  it("speichert einen Kalendertag als UTC-Mitternacht und liest ihn verlustfrei zurück", () => {
    expect(toDbDate("2026-09-25").toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(fromDbDate(new Date("2026-09-25T00:00:00.000Z"))).toBe("2026-09-25");
    expect(fromDbDate(toDbDate("2026-10-25"))).toBe("2026-10-25");
  });

  it("parseCalendarDate akzeptiert nur existierende Tage im Format JJJJ-MM-TT", () => {
    expect(parseCalendarDate("2026-09-25")).toBe("2026-09-25");
    expect(parseCalendarDate("2028-02-29")).toBe("2028-02-29");
    for (const invalid of ["", "2026-9-25", "25.09.2026", "2026-02-30", "2026-13-01", "2026-09-25T08:00:00Z", "heute"]) {
      expect(parseCalendarDate(invalid)).toBeNull();
    }
  });

  it("formatCalendarDate beschriftet den Tag selbst, nicht den Tag in Server- oder Browserzeit", () => {
    expect(formatCalendarDate("2026-09-25", { weekday: "long", day: "2-digit", month: "long" })).toBe("Freitag, 25. September");
  });
});

describe("unabhängig von der Zeitzone des Servers", () => {
  const originalTimeZone = process.env.TZ;
  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  // Offset am 15.01. (Winterzeit) in Minuten, wie ihn `getTimezoneOffset()` liefert.
  const serverZones = [
    ["Europe/Berlin", -60],
    ["America/Los_Angeles", 480],
    ["Asia/Tokyo", -540],
    ["UTC", 0],
  ] as const;

  it.each(serverZones)("liefert auf einem Server in %s dieselben Kalendertage", (serverTimeZone, expectedOffset) => {
    process.env.TZ = serverTimeZone;
    // Sicherstellen, dass die Simulation greift: lokale Date-Methoden sehen jetzt diese Zone.
    expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(expectedOffset);

    expect(todayForUser(new Date("2026-09-25T23:30:00+02:00"))).toBe("2026-09-25");
    expect(todayForUser(new Date("2026-09-26T00:30:00+02:00"))).toBe("2026-09-26");
    expect(toDbDate("2026-09-25").toISOString()).toBe("2026-09-25T00:00:00.000Z");
    expect(fromDbDate(toDbDate("2026-09-25"))).toBe("2026-09-25");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21");
    expect(weekdayIndex("2026-09-25")).toBe(4);
    expect(formatCalendarDate("2026-09-25", { weekday: "long", day: "2-digit", month: "long" })).toBe("Freitag, 25. September");
  });
});
