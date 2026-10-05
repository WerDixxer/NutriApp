import { describe, expect, it, vi } from "vitest";
import { REVOKE_INVITE_FAILED_MESSAGE, revokeInvite } from "./householdRequests";

const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

describe("revokeInvite (R5F-3)", () => {
  it("Erfolg nur mit bestätigter Antwort", async () => {
    const fetchImpl = respond(Response.json({ ok: true }));

    expect(await revokeInvite("invite-1", fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/household/invites/invite-1", { method: "DELETE" });
  });

  it.each([
    ["403 (kein Owner)", Response.json({ error: "Nur der Owner kann Einladungen zurückziehen." }, { status: 403 })],
    ["500", new Response("<html>Fehler</html>", { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, die Einladung bleibt in der Anzeige", async (_label, response) => {
    expect(await revokeInvite("invite-1", respond(response))).toEqual({ ok: false, message: REVOKE_INVITE_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await revokeInvite("invite-1", fetchImpl)).toEqual({ ok: false, message: REVOKE_INVITE_FAILED_MESSAGE });
  });
});
