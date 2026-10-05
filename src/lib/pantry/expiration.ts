import { daysBetween, fromDbDate, todayForUser } from "../calendarDate";

export interface ExpirationStatus {
  /** null, solange kein Ablaufdatum bekannt ist. */
  daysUntilExpiration: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

const EXPIRING_SOON_THRESHOLD_DAYS = 2;

/**
 * Reine Funktion, unabhängig davon, ob das Datum `EXACT` oder `ESTIMATED`
 * ist (das entscheidet nur, wie die UI es beschriftet, siehe
 * `ExpirationDateType`). Bei `null` (kein/`UNKNOWN`-Datum) wird nichts
 * erfunden, alle Flags bleiben neutral `false`.
 *
 * Das Ablaufdatum ist ein Kalendertag, gespeichert als UTC-Mitternacht (wie `toDbDate`); "heute" ist der
 * Kalendertag des Nutzers (`todayForUser`, Europe/Berlin). Gezählt werden Kalendertage dazwischen -
 * unabhängig von der Zeitzone des Servers.
 */
export function getExpirationStatus(expirationDate: Date | null, now: Date = new Date()): ExpirationStatus {
  if (!expirationDate) {
    return { daysUntilExpiration: null, isExpired: false, isExpiringSoon: false };
  }

  const days = daysBetween(todayForUser(now), fromDbDate(expirationDate));

  return {
    daysUntilExpiration: days,
    isExpired: days < 0,
    isExpiringSoon: days >= 0 && days <= EXPIRING_SOON_THRESHOLD_DAYS,
  };
}
