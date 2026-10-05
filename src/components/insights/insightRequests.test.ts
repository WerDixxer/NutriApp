import { describe, expect, it, vi } from "vitest";
import { DISMISS_FAILED_MESSAGE, dismissInsight } from "./insightRequests";

const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

describe("dismissInsight (R5F-3)", () => {
  it("Erfolg nur mit bestätigter Antwort; sendet den Insight-Schlüssel", async () => {
    const fetchImpl = respond(Response.json({ ok: true }));

    expect(await dismissInsight("pantry-expiring:item-1", fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/insights/dismiss",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ insightKey: "pantry-expiring:item-1" }) }),
    );
  });

  it.each([
    ["400", Response.json({ error: "Ungültige Anfrage." }, { status: 400 })],
    ["500", new Response("<html>Fehler</html>", { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, der Hinweis bleibt sichtbar", async (_label, response) => {
    expect(await dismissInsight("key", respond(response))).toEqual({ ok: false, message: DISMISS_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await dismissInsight("key", fetchImpl)).toEqual({ ok: false, message: DISMISS_FAILED_MESSAGE });
  });
});
