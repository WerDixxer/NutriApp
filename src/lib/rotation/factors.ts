import type { ExpirationStatus } from "../pantry/expiration";
import { EXPIRY_TIER_DAYS, ROTATION_WEIGHTS } from "./weights";
import type { RotationItemInput } from "./types";

export interface RotationFactorResult {
  factor: string;
  points: number;
  /** Nur gesetzt, wenn der Faktor tatsächlich etwas Nennenswertes zur Priorisierung beigetragen hat. */
  reason?: string;
  /** Getrennt von `reason`: ein eigenständiger Hinweis, der NIE eine Aussage zur Genusstauglichkeit trifft. */
  warning?: string;
}

function estimatedSuffix(type: RotationItemInput["expirationDateType"]): string {
  return type === "ESTIMATED" ? " (geschätzt)" : "";
}

/**
 * A. Expiration + B. Expiration Type. Ohne Datum (`expirationDate === null`,
 * das ist bei `UNKNOWN` immer der Fall, siehe validation/pantry.ts) gibt es
 * NICHTS zu bewerten, 0 Punkte, kein erfundenes Signal. Ein `EXPIRED`-Item
 * bekommt neben den Punkten eine eigenständige `warning`, die ausdrücklich
 * KEINE Aussage zur Genusstauglichkeit trifft (weder "schlecht" noch "noch
 * ok"), siehe Kapitel-Auftrag Abschnitt 11.
 */
export function scoreExpiration(item: RotationItemInput, status: ExpirationStatus): RotationFactorResult {
  if (!item.expirationDate || status.daysUntilExpiration === null) {
    return { factor: "expiration", points: 0 };
  }

  const multiplier = item.expirationDateType === "ESTIMATED" ? ROTATION_WEIGHTS.estimatedMultiplier : 1;
  const suffix = estimatedSuffix(item.expirationDateType);
  const days = status.daysUntilExpiration;

  if (status.isExpired) {
    return {
      factor: "expiration",
      points: ROTATION_WEIGHTS.expiredPoints * multiplier,
      reason: `Ablaufdatum überschritten${suffix}.`,
      warning: "Ablaufdatum überschritten. Die Engine trifft keine Aussage zur Genusstauglichkeit, bitte selbst prüfen.",
    };
  }
  if (days <= EXPIRY_TIER_DAYS.today) {
    return { factor: "expiration", points: ROTATION_WEIGHTS.expiresTodayPoints * multiplier, reason: `Läuft heute ab${suffix}.` };
  }
  if (days <= EXPIRY_TIER_DAYS.fewDaysMax) {
    return {
      factor: "expiration",
      points: ROTATION_WEIGHTS.expiresFewDaysPoints * multiplier,
      reason: `Läuft in ${days} Tagen ab${suffix}.`,
    };
  }
  if (days <= EXPIRY_TIER_DAYS.weekMax) {
    return {
      factor: "expiration",
      points: ROTATION_WEIGHTS.expiresWeekPoints * multiplier,
      reason: `Läuft in ${days} Tagen ab${suffix}.`,
    };
  }
  return { factor: "expiration", points: ROTATION_WEIGHTS.expiresLaterPoints * multiplier };
}

/**
 * C. Opened + D. Cooked/Leftover. Getrennte Faktoren (nicht addiert zu
 * einem), damit jeder für sich in `reasons` auftaucht, falls beide zutreffen.
 */
export function scoreOpenedCooked(item: RotationItemInput): RotationFactorResult[] {
  const results: RotationFactorResult[] = [];
  if (item.cooked) {
    results.push({ factor: "cooked", points: ROTATION_WEIGHTS.cookedPoints, reason: "Bereits gekocht (Rest)." });
  }
  if (item.opened) {
    results.push({ factor: "opened", points: ROTATION_WEIGHTS.openedPoints, reason: "Bereits geöffnet." });
  }
  return results;
}

/**
 * E. Remaining Quantity. Vergleicht `remainingQuantity` mit `quantity` IM
 * SELBEN Datensatz (also derselben Einheit), keine Umrechnung, keine
 * erfundene Portionsgröße.
 */
export function scoreRemainingQuantity(item: RotationItemInput): RotationFactorResult {
  if (item.quantity <= 0 || item.remainingQuantity <= 0) return { factor: "remainingQuantity", points: 0 };
  const ratio = item.remainingQuantity / item.quantity;
  if (ratio <= ROTATION_WEIGHTS.smallRemainingRatio) {
    return {
      factor: "remainingQuantity",
      points: ROTATION_WEIGHTS.smallRemainingPoints,
      reason: "Nur noch eine kleine Restmenge vorhanden.",
    };
  }
  return { factor: "remainingQuantity", points: 0 };
}

/** F. Age. Ersetzt niemals das Ablaufdatum, trägt nur bei, wenn `purchaseDate` tatsächlich vorhanden ist. */
export function scoreAge(item: RotationItemInput, now: Date): RotationFactorResult {
  if (!item.purchaseDate) return { factor: "age", points: 0 };
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysPresent = Math.floor((now.getTime() - item.purchaseDate.getTime()) / msPerDay);
  if (daysPresent >= ROTATION_WEIGHTS.longPresentDays) {
    return { factor: "age", points: ROTATION_WEIGHTS.longPresentPoints, reason: "Schon länger vorhanden." };
  }
  return { factor: "age", points: 0 };
}

/**
 * G. Storage Location. Bewusst OHNE `reason`-Text (siehe weights.ts), um
 * keine Haltbarkeits-/Sicherheitsbehauptung zu formulieren, nur ein sehr
 * milder Score-Nudge.
 */
export function scoreLocation(item: RotationItemInput): RotationFactorResult {
  if (item.location === "FRIDGE" && item.opened) {
    return { factor: "location", points: ROTATION_WEIGHTS.fridgeOpenedBonusPoints };
  }
  return { factor: "location", points: 0 };
}
