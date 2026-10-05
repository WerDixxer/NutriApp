import { describe, expect, it, vi } from "vitest";
import { LOAD_FAILED_MESSAGE, loadTrendTags, SAVE_FAILED_MESSAGE, saveTrendTags } from "./trendTagRequests";

const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
const offline = () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

describe("loadTrendTags (R5F-3)", () => {
  it("liefert die gespeicherten Tags", async () => {
    expect(await loadTrendTags(respond(Response.json({ profile: { age: 30, subscribedTrendTags: ["vegan", "airfryer"] } })))).toEqual({
      ok: true,
      tags: ["vegan", "airfryer"],
    });
  });

  it("ohne Profil: keine gespeicherten Tags", async () => {
    expect(await loadTrendTags(respond(Response.json({ profile: null })))).toEqual({ ok: true, tags: [] });
  });

  it.each([
    ["500 (z.B. unlesbare gespeicherte Tags)", Response.json({ error: "Fehler" }, { status: 500 })],
    ["401", Response.json({ error: "Nicht angemeldet." }, { status: 401 })],
    ["kein JSON", new Response("<html>Fehler</html>", { status: 200 })],
    ["Tags fehlen", Response.json({ profile: { age: 30 } })],
    ["Tags in falscher Form", Response.json({ profile: { subscribedTrendTags: "vegan" } })],
  ])("Ladefehler (%s): nie eine leere Auswahl, die später gespeichert würde", async (_label, response) => {
    expect(await loadTrendTags(respond(response))).toEqual({ ok: false, message: LOAD_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: Ladefehler statt Ausnahme", async () => {
    expect(await loadTrendTags(offline())).toEqual({ ok: false, message: LOAD_FAILED_MESSAGE });
  });
});

describe("saveTrendTags (R5F-3)", () => {
  it("Erfolg nur mit bestätigter Antwort; sendet die vollständige Liste", async () => {
    const fetchImpl = respond(Response.json({ ok: true }));

    expect(await saveTrendTags(["vegan"], fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/profile/trend-tags",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tags: ["vegan"] }) }),
    );
  });

  it.each([
    ["404 (kein Profil)", Response.json({ error: "Kein Profil vorhanden." }, { status: 404 })],
    ["500", new Response("<html>Fehler</html>", { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, die Auswahl bleibt wie gespeichert", async (_label, response) => {
    expect(await saveTrendTags(["vegan"], respond(response))).toEqual({ ok: false, message: SAVE_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    expect(await saveTrendTags(["vegan"], offline())).toEqual({ ok: false, message: SAVE_FAILED_MESSAGE });
  });
});
