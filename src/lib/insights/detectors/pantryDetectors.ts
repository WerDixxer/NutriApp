import { getExpirationStatus } from "../../pantry/expiration";
import type { Insight } from "../types";

export interface PantryInsightItem {
  id: string;
  name: string;
  remainingQuantity: number;
  expirationDate: Date | null;
}

/**
 * "Bald ablaufend" und "bereits abgelaufen" sind bewusst getrennte Regeln
 * (unterschiedliche `type`/Priorität/Formulierung), nicht eine Regel mit
 * einem Prozentsatz - siehe rotation/expiration.ts, dessen `isExpired`/
 * `isExpiringSoon` hier direkt wiederverwendet werden statt einer eigenen
 * zweiten Ablauf-Berechnung.
 *
 * Der Tage-Bucket (`daysUntilExpiration`) ist Teil der stabilen id: läuft ein
 * Item von "morgen" auf "heute" um, ist das eine ANDERE id, das Insight
 * erscheint also auch dann wieder, wenn die "morgen"-Version bereits
 * abgewiesen wurde (Kapitel-Auftrag Abschnitt 6: Dringlichkeit darf
 * zunehmen, ohne durch eine alte Ablehnung unterdrückt zu bleiben).
 */
export function detectPantryExpiringSoon(items: PantryInsightItem[], now: Date = new Date()): Insight[] {
  const insights: Insight[] = [];

  for (const item of items) {
    if (item.remainingQuantity <= 0) continue;
    const status = getExpirationStatus(item.expirationDate, now);
    if (!status.isExpiringSoon || status.daysUntilExpiration === null) continue;

    const days = status.daysUntilExpiration;
    const message =
      days === 0
        ? `Deine ${item.name} sind heute das letzte Mal haltbar.`
        : days === 1
          ? `Deine ${item.name} sind nur noch bis morgen haltbar.`
          : `Deine ${item.name} sind noch ${days} Tage haltbar.`;

    insights.push({
      id: `pantry:expiring-soon:${item.id}:${days}`,
      type: "PANTRY_EXPIRING_SOON",
      category: "PANTRY",
      priority: days === 0 ? "critical" : "important",
      message,
      context: { pantryItemId: item.id, name: item.name, daysUntilExpiration: days },
      source: { entity: "PantryItem", id: item.id },
      surfaces: ["DASHBOARD", "PANTRY"],
      action: { label: "Vorräte ansehen", href: "/pantry" },
      detectedAt: now,
      expiresAt: item.expirationDate,
    });
  }

  return insights;
}

/**
 * Ausschließlich Items mit tatsächlich vorhandenem Restbestand - ein
 * abgelaufenes, aber bereits vollständig verbrauchtes Item (remainingQuantity
 * 0) ist für den Nutzer nicht mehr relevant, siehe rotationEngine.ts, das
 * dieselbe Unterscheidung trifft.
 */
export function detectPantryExpired(items: PantryInsightItem[], now: Date = new Date()): Insight[] {
  const insights: Insight[] = [];

  for (const item of items) {
    if (item.remainingQuantity <= 0) continue;
    const status = getExpirationStatus(item.expirationDate, now);
    if (!status.isExpired || status.daysUntilExpiration === null) continue;

    const daysOverdue = Math.abs(status.daysUntilExpiration);
    const message =
      daysOverdue === 1
        ? `Deine ${item.name} sind seit gestern abgelaufen.`
        : `Deine ${item.name} sind seit ${daysOverdue} Tagen abgelaufen.`;

    insights.push({
      id: `pantry:expired:${item.id}`,
      type: "PANTRY_EXPIRED",
      category: "PANTRY",
      priority: "critical",
      message,
      context: { pantryItemId: item.id, name: item.name, daysOverdue },
      source: { entity: "PantryItem", id: item.id },
      surfaces: ["DASHBOARD", "PANTRY"],
      action: { label: "Vorräte ansehen", href: "/pantry" },
      detectedAt: now,
      expiresAt: null,
    });
  }

  return insights;
}
