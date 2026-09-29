import { describe, expect, it } from "vitest";
import { todayForUser, type CalendarDate } from "./calendarDate";
import { isHistoricalPlanDay } from "./planDayBoundary";

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
