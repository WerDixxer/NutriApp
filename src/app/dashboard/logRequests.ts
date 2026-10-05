import { z } from "zod";
import type { LogPayload } from "@/lib/validation/log";

/**
 * Die Log-Anfragen des Dashboards (R5F-2). Als geloggt bzw. entfernt gilt eine Mahlzeit erst, wenn
 * der Server das bestätigt hat: HTTP-Fehler, Netzwerkfehler und unerwartete Antworten sind immer ein
 * Fehler, nie ein Erfolg - sonst zeigt das Dashboard einen anderen Stand als die Datenbank.
 */
export type LogRequestResult<Success> = ({ ok: true } & Success) | { ok: false; message: string };

export const LOG_FAILED_MESSAGE = "Die Mahlzeit konnte nicht geloggt werden. Bitte versuche es erneut.";
export const REMOVE_FAILED_MESSAGE = "Der Eintrag konnte nicht entfernt werden. Bitte versuche es erneut.";

/** Der Body für POST /api/log (Schema siehe validation/log.ts); den Slot prüft der Server. */
export type LogEntryRequestBody = Omit<LogPayload, "slot"> & { slot: string };

const createdEntrySchema = z.object({ entry: z.object({ id: z.string().min(1) }) });

/** Legt einen Log-Eintrag an; Erfolg nur mit Status 2xx UND der ID des gespeicherten Eintrags. */
export async function createLogEntry(
  payload: LogEntryRequestBody,
  fetchImpl: typeof fetch = fetch,
): Promise<LogRequestResult<{ entryId: string }>> {
  try {
    const res = await fetchImpl("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, message: LOG_FAILED_MESSAGE };
    const parsed = createdEntrySchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, message: LOG_FAILED_MESSAGE };
    return { ok: true, entryId: parsed.data.entry.id };
  } catch {
    return { ok: false, message: LOG_FAILED_MESSAGE };
  }
}

/** Entfernt einen Log-Eintrag; Erfolg nur mit Status 2xx. */
export async function deleteLogEntry(id: string, fetchImpl: typeof fetch = fetch): Promise<LogRequestResult<object>> {
  try {
    const res = await fetchImpl(`/api/log?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok ? { ok: true } : { ok: false, message: REMOVE_FAILED_MESSAGE };
  } catch {
    return { ok: false, message: REMOVE_FAILED_MESSAGE };
  }
}
