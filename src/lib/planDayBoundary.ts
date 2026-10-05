import { addDays, daysBetween, startOfWeek, type CalendarDate } from "./calendarDate";

/**
 * Bearbeitungsgrenze für Pläne (R5E): Gestern und früher sind historisch, heute und die Zukunft
 * bearbeitbar. Ein historischer Plan zeigt, was damals geplant war - er wird weder gelöscht noch
 * überschrieben, und ein fehlender historischer Tag wird nie nachträglich erzeugt.
 *
 * `today` ist der Kalendertag des Nutzers (`todayForUser`, src/lib/calendarDate.ts), den der Aufrufer
 * einmal pro Request bestimmt und durchreicht. Diese Funktionen lesen selbst keine Uhr.
 */
export function isHistoricalPlanDay(day: CalendarDate, today: CalendarDate): boolean {
  return daysBetween(today, day) < 0;
}

/**
 * Planungshorizont (R5F-13): Persönliche Tagespläne werden automatisch höchstens bis zum Sonntag der
 * nächsten Kalenderwoche (Montag bis Sonntag) erzeugt bzw. neu geplant - also die laufende und die
 * nächste Woche. Gespeicherte Pläne dahinter bleiben unverändert und lesbar; die Grenze betrifft nur
 * das automatische Erzeugen und Neuplanen.
 */
export function lastAutomaticallyPlannableDay(today: CalendarDate): CalendarDate {
  const nextMonday = addDays(startOfWeek(today), 7);
  return addDays(nextMonday, 6);
}

/** Liegt `day` hinter dem Planungshorizont, wird er nicht automatisch erzeugt oder neu geplant. */
export function isBeyondAutomaticPlanningHorizon(day: CalendarDate, today: CalendarDate): boolean {
  return daysBetween(lastAutomaticallyPlannableDay(today), day) > 0;
}
