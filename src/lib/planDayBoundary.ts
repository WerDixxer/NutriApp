import { daysBetween, type CalendarDate } from "./calendarDate";

/**
 * Bearbeitungsgrenze für Pläne (R5E): Gestern und früher sind historisch, heute und die Zukunft
 * bearbeitbar. Ein historischer Plan zeigt, was damals geplant war - er wird weder gelöscht noch
 * überschrieben, und ein fehlender historischer Tag wird nie nachträglich erzeugt.
 *
 * `today` ist der Kalendertag des Nutzers (`todayForUser`, src/lib/calendarDate.ts), den der Aufrufer
 * einmal pro Request bestimmt und durchreicht. Diese Funktion liest selbst keine Uhr.
 */
export function isHistoricalPlanDay(day: CalendarDate, today: CalendarDate): boolean {
  return daysBetween(today, day) < 0;
}
