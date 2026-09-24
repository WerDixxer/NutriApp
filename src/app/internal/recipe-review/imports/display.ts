import type { ImportQueueStatus } from "@/lib/recipes/importWorkflow";

/** Gemeinsame Anzeige-Helfer der Import-Queue (Liste und Detailseite). */

const DATE_FORMAT = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" });

export function formatReviewDate(date: Date): string {
  return DATE_FORMAT.format(date);
}

export const IMPORT_STATUS_TONE: Record<ImportQueueStatus, string> = {
  pending_review: "text-ink-soft",
  needs_changes: "text-warn",
  approved: "text-primary",
  rejected: "text-danger",
  published: "text-primary",
  failed: "text-danger",
};
