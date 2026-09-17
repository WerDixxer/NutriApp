export interface ExpirationStatus {
  /** null, solange kein Ablaufdatum bekannt ist. */
  daysUntilExpiration: number | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

const EXPIRING_SOON_THRESHOLD_DAYS = 2;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Reine Funktion, unabhängig davon, ob das Datum `EXACT` oder `ESTIMATED`
 * ist (das entscheidet nur, wie die UI es beschriftet, siehe
 * `ExpirationDateType`). Bei `null` (kein/`UNKNOWN`-Datum) wird nichts
 * erfunden, alle Flags bleiben neutral `false`.
 */
export function getExpirationStatus(expirationDate: Date | null, now: Date = new Date()): ExpirationStatus {
  if (!expirationDate) {
    return { daysUntilExpiration: null, isExpired: false, isExpiringSoon: false };
  }

  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.round((startOfDay(expirationDate).getTime() - startOfDay(now).getTime()) / msPerDay);

  return {
    daysUntilExpiration: days,
    isExpired: days < 0,
    isExpiringSoon: days >= 0 && days <= EXPIRING_SOON_THRESHOLD_DAYS,
  };
}
