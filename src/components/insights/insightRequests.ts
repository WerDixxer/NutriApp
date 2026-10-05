/**
 * Ausblenden eines Hinweises: Er verschwindet erst nach Bestätigung des Servers (R5F-3), sonst taucht
 * er beim nächsten Laden wieder auf, obwohl die Anzeige "ausgeblendet" gezeigt hat.
 */
export type InsightRequestResult = { ok: true } | { ok: false; message: string };

export const DISMISS_FAILED_MESSAGE = "Der Hinweis konnte nicht ausgeblendet werden. Bitte versuche es erneut.";

export async function dismissInsight(insightKey: string, fetchImpl: typeof fetch = fetch): Promise<InsightRequestResult> {
  try {
    const res = await fetchImpl("/api/insights/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ insightKey }),
    });
    return res.ok ? { ok: true } : { ok: false, message: DISMISS_FAILED_MESSAGE };
  } catch {
    return { ok: false, message: DISMISS_FAILED_MESSAGE };
  }
}
