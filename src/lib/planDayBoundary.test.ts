import { describe, expect, it } from "vitest";
import { todayForUser, type CalendarDate } from "./calendarDate";
import { isBeyondAutomaticPlanningHorizon, isHistoricalPlanDay, lastAutomaticallyPlannableDay } from "./planDayBoundary";

describe("isHistoricalPlanDay (R5E)", () => {
  it.each([
    ["gestern", "2026-09-17", true],
    ["heute", "2026-09-18", false],
    ["morgen", "2026-09-19", false],
    ["weit in der Vergangenheit", "2025-12-31", true],
    ["weit in der Zukunft", "2027-01-01", false],
  ] as const)("mit heute = 2026-09-18 ist %s (%s) historisch: %s", (_label, day, historical) => {
    expect(isHistoricalPlanDay(day, "2026-09-18")).toBe(historical);
  });

  it.each([
    ["Monatswechsel", "2026-09-30", "2026-10-01"],
    ["Jahreswechsel", "2026-12-31", "2027-01-01"],
    ["Schalttag", "2028-02-29", "2028-03-01"],
  ] as const)("trennt am %s den Vortag (historisch) von heute (bearbeitbar)", (_label, yesterday, today) => {
    expect(isHistoricalPlanDay(yesterday as CalendarDate, today as CalendarDate)).toBe(true);
    expect(isHistoricalPlanDay(today as CalendarDate, today as CalendarDate)).toBe(false);
  });

  it("richtet sich nach dem Kalendertag in Deutschland, nicht nach UTC", () => {
    // 00:30 Uhr am 18.09. in Berlin, in UTC noch der 17.09., 22:30.
    const today = todayForUser(new Date("2026-09-18T00:30:00+02:00"));

    expect(today).toBe("2026-09-18");
    expect(isHistoricalPlanDay("2026-09-17", today)).toBe(true);
    expect(isHistoricalPlanDay("2026-09-18", today)).toBe(false);
  });
});

describe("Planungshorizont: bis Sonntag der nächsten Kalenderwoche (R5F-13)", () => {
  it.each([
    ["Montag", "2026-09-21", "2026-10-04"],
    ["Mittwoch", "2026-09-23", "2026-10-04"],
    ["Sonntag", "2026-09-27", "2026-10-04"],
    ["Montag danach", "2026-09-28", "2026-10-11"],
    ["über den Monatswechsel", "2026-09-30", "2026-10-11"],
    ["über den Jahreswechsel", "2026-12-30", "2027-01-10"],
    ["mit Schalttag", "2028-02-23", "2028-03-05"],
  ] as const)("heute %s (%s): letzter automatisch planbarer Tag ist %s", (_label, today, last) => {
    expect(lastAutomaticallyPlannableDay(today)).toBe(last);
  });

  /** heute = Montag, 21.09.2026: laufende Woche bis 27.09., nächste Woche 28.09. bis 04.10. */
  const TODAY: CalendarDate = "2026-09-21";
  it.each([
    ["gestern (historisch, nicht hinter dem Horizont)", "2026-09-20", false],
    ["heute", "2026-09-21", false],
    ["letzter Tag der laufenden Woche", "2026-09-27", false],
    ["erster Tag der nächsten Woche", "2026-09-28", false],
    ["letzter Tag der nächsten Woche", "2026-10-04", false],
    ["erster Tag der übernächsten Woche", "2026-10-05", true],
    ["weit entfernt", "2099-06-15", true],
  ] as const)("%s (%s) liegt hinter dem Horizont: %s", (_label, day, beyond) => {
    expect(isBeyondAutomaticPlanningHorizon(day, TODAY)).toBe(beyond);
  });

  it("richtet sich nach dem Kalendertag in Deutschland: Montag 00:30 Uhr gehört schon zur neuen Woche", () => {
    // In UTC ist es noch Sonntag, 27.09., 22:30 - nach UTC wäre der 11.10. hinter dem Horizont.
    const today = todayForUser(new Date("2026-09-28T00:30:00+02:00"));

    expect(today).toBe("2026-09-28");
    expect(isBeyondAutomaticPlanningHorizon("2026-10-11", today)).toBe(false);
    expect(isBeyondAutomaticPlanningHorizon("2026-10-12", today)).toBe(true);
  });
});
