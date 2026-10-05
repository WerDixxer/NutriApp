import { z } from "zod";

/**
 * Schreibanfragen des Vorrats, deren Ergebnis die Anzeige erst nach Bestätigung des Servers übernimmt
 * (R5F-3). HTTP-Fehler, Netzwerkfehler und unerwartete Antworten sind immer ein Fehler.
 */
export type PantryRequestResult<Success extends object = object> = ({ ok: true } & Success) | { ok: false; message: string };

export const DELETE_FAILED_MESSAGE = "Der Vorrat konnte nicht entfernt werden. Bitte versuche es erneut.";
export const ADJUST_FAILED_MESSAGE = "Die Menge konnte nicht geändert werden. Bitte versuche es erneut.";

const adjustedItemSchema = z.object({ item: z.object({ remainingQuantity: z.number() }) });

export async function deletePantryItem(id: string, fetchImpl: typeof fetch = fetch): Promise<PantryRequestResult> {
  try {
    const res = await fetchImpl(`/api/pantry/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok ? { ok: true } : { ok: false, message: DELETE_FAILED_MESSAGE };
  } catch {
    return { ok: false, message: DELETE_FAILED_MESSAGE };
  }
}

/** Erfolg nur mit Status 2xx UND der neuen Restmenge aus der Antwort. */
export async function adjustPantryQuantity(
  id: string,
  type: "add" | "consume",
  amount: number,
  fetchImpl: typeof fetch = fetch,
): Promise<PantryRequestResult<{ remainingQuantity: number }>> {
  try {
    const res = await fetchImpl(`/api/pantry/${encodeURIComponent(id)}/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, amount }),
    });
    if (!res.ok) return { ok: false, message: ADJUST_FAILED_MESSAGE };
    const parsed = adjustedItemSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, message: ADJUST_FAILED_MESSAGE };
    return { ok: true, remainingQuantity: parsed.data.item.remainingQuantity };
  } catch {
    return { ok: false, message: ADJUST_FAILED_MESSAGE };
  }
}
