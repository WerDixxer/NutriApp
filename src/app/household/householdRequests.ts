/**
 * Zurückziehen einer Einladung: Die Anzeige übernimmt das erst nach Bestätigung des Servers (R5F-3).
 * HTTP- und Netzwerkfehler sind immer ein Fehler.
 */
export type HouseholdRequestResult = { ok: true } | { ok: false; message: string };

export const REVOKE_INVITE_FAILED_MESSAGE = "Die Einladung konnte nicht zurückgezogen werden. Bitte versuche es erneut.";

export async function revokeInvite(inviteId: string, fetchImpl: typeof fetch = fetch): Promise<HouseholdRequestResult> {
  try {
    const res = await fetchImpl(`/api/household/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" });
    return res.ok ? { ok: true } : { ok: false, message: REVOKE_INVITE_FAILED_MESSAGE };
  } catch {
    return { ok: false, message: REVOKE_INVITE_FAILED_MESSAGE };
  }
}
