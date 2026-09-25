/**
 * Kalendertage und Zeitpunkte (F-10). Zwei Arten von Zeitangaben, die nicht vermischt werden dürfen:
 *
 * - Zeitpunkt (Instant): ein `Date`, z.B. `createdAt` oder "jetzt". Ein absoluter Moment, der in
 *   jeder Zeitzone derselbe ist.
 * - Kalendertag (`CalendarDate`): "JJJJ-MM-TT" im Kalender des Nutzers, z.B. der Tag eines
 *   Tagesplans oder Log-Eintrags. Der 25.09. beginnt in Berlin und in Tokio zu verschiedenen
 *   Zeitpunkten, ist aber derselbe Kalendertag.
 *
 * Vom Zeitpunkt zum Kalendertag geht es nur über eine Zeitzone (`calendarDateInTimeZone`,
 * `todayForUser`). Die Zeitzone des Servers spielt nirgends eine Rolle: Dieses Modul nutzt keine
 * lokalen Date-Methoden (`getDate`, `setHours`, ...), sondern rechnet in UTC bzw. mit Intl.
 *
 * In der Datenbank (DateTime-Spalten wie MealPlanDay.date, LogEntry.date, MealPlanMeal.date) steht
 * ein Kalendertag als UTC-Mitternacht dieses Tages (`toDbDate`/`fromDbDate`). In genau dieser Form
 * liefert Prisma später eine PostgreSQL-Spalte `@db.Date` - die Bedeutung bleibt beim Wechsel gleich.
 */

/** Ein Tag im Kalender des Nutzers, immer "JJJJ-MM-TT". Aus Text nur über `parseCalendarDate`. */
export type CalendarDate = `${number}-${number}-${number}`;

/**
 * Die Zeitzone, in der VYN den Kalendertag eines Nutzers bestimmt. Es gibt (noch) kein Profilfeld
 * für die Zeitzone; bis dahin gilt für alle Nutzer die deutsche Zeit. Wird nur hier festgelegt.
 */
export const ASSUMED_USER_TIME_ZONE = "Europe/Berlin";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcMidnightOf(date: CalendarDate): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function calendarDateOfUtc(value: Date): CalendarDate {
  return value.toISOString().slice(0, 10) as CalendarDate;
}

/** "JJJJ-MM-TT" mit einem existierenden Datum (kein 2026-02-30), sonst `null`. */
export function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
  return value as CalendarDate;
}

/** Der Kalendertag, auf den der Zeitpunkt `instant` in der Zeitzone `timeZone` (IANA-Name) fällt. */
export function calendarDateInTimeZone(instant: Date, timeZone: string): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const part = (type: "year" | "month" | "day") => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}` as CalendarDate;
}

/** Heute im Kalender des Nutzers (Zeitzone: `ASSUMED_USER_TIME_ZONE`). `now` ist ein Zeitpunkt. */
export function todayForUser(now: Date = new Date()): CalendarDate {
  return calendarDateInTimeZone(now, ASSUMED_USER_TIME_ZONE);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  const utc = utcMidnightOf(date);
  utc.setUTCDate(utc.getUTCDate() + days);
  return calendarDateOfUtc(utc);
}

/** Anzahl Kalendertage von `from` bis `to` (negativ, wenn `to` davor liegt). */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return Math.round((utcMidnightOf(to).getTime() - utcMidnightOf(from).getTime()) / MS_PER_DAY);
}

/** 0 = Montag ... 6 = Sonntag, wie überall in VYN. */
export function weekdayIndex(date: CalendarDate): number {
  return (utcMidnightOf(date).getUTCDay() + 6) % 7;
}

/** Der Montag der Woche (Montag bis Sonntag), in der `date` liegt. */
export function startOfWeek(date: CalendarDate): CalendarDate {
  return addDays(date, -weekdayIndex(date));
}

/** Jahr, Monat (1-12) und Tag, z.B. für Beschriftungen. */
export function calendarDateParts(date: CalendarDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

/** Anzeige eines Kalendertags auf Deutsch, unabhängig von Server- und Browserzeitzone. */
export function formatCalendarDate(date: CalendarDate, options: Intl.DateTimeFormatOptions): string {
  return utcMidnightOf(date).toLocaleDateString("de-DE", { ...options, timeZone: "UTC" });
}

/** Der DB-Wert eines Kalendertags: UTC-Mitternacht dieses Tages (siehe Modulkommentar). */
export function toDbDate(date: CalendarDate): Date {
  return utcMidnightOf(date);
}

/** Der Kalendertag eines DB-Werts, der als UTC-Mitternacht gespeichert ist (siehe `toDbDate`). */
export function fromDbDate(value: Date): CalendarDate {
  return calendarDateOfUtc(value);
}
