import { getExpirationStatus } from "./expiration";

export interface RotationInput {
  opened: boolean;
  cooked: boolean;
  expirationDate: Date | null;
  purchaseDate: Date | null;
}

export type RotationUrgency = "HIGH" | "MEDIUM" | "LOW";

export interface RotationResult {
  urgency: RotationUrgency;
  /** Nur zum Sortieren/Kennzeichnen, höher = dringender. Keine finale Entscheidung, siehe Kommentar unten. */
  score: number;
  reasons: string[];
}

const LONG_PRESENT_DAYS = 14;

/**
 * Grobe, erklärbare Dringlichkeits-Heuristik für dieses Kapitel: bereits
 * geöffnet > gekocht > läuft bald ab > lange vorhanden > ungeöffnet/lange
 * haltbar. Bewusst NICHT als finale Entscheidung gedacht, das wird erst die
 * echte Food Rotation Engine (Kapitel 7). Hier reicht: Pantry Items lassen
 * sich danach sortieren und mit einer Dringlichkeitsstufe kennzeichnen.
 */
export function computeRotationPriority(item: RotationInput, now: Date = new Date()): RotationResult {
  const reasons: string[] = [];
  let score = 0;

  const expiration = getExpirationStatus(item.expirationDate, now);
  if (expiration.isExpired) {
    score += 100;
    reasons.push("Ablaufdatum überschritten.");
  } else if (expiration.isExpiringSoon) {
    score += 50;
    reasons.push("Läuft bald ab.");
  }

  if (item.opened) {
    score += 30;
    reasons.push("Bereits geöffnet.");
  }
  if (item.cooked) {
    score += 20;
    reasons.push("Bereits gekocht.");
  }

  if (item.purchaseDate) {
    const msPerDay = 1000 * 60 * 60 * 24;
    const daysPresent = Math.floor((now.getTime() - item.purchaseDate.getTime()) / msPerDay);
    if (daysPresent >= LONG_PRESENT_DAYS) {
      score += 10;
      reasons.push("Schon länger vorhanden.");
    }
  }

  const urgency: RotationUrgency = score >= 50 ? "HIGH" : score >= 20 ? "MEDIUM" : "LOW";
  return { urgency, score, reasons };
}
