import { describe, expect, it, vi } from "vitest";
import { createLogEntry, deleteLogEntry, LOG_FAILED_MESSAGE, REMOVE_FAILED_MESSAGE, type LogEntryRequestBody } from "./logRequests";

const payload: LogEntryRequestBody = {
  date: "2026-09-24",
  slot: "LUNCH",
  recipeId: "recipe-1",
  customName: "Reis-Bowl",
  kcal: 450,
  proteinG: 25,
  carbsG: 50,
  fatG: 12,
};

function fetchReturning(response: Response | Promise<Response>) {
  return vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(response));
}

describe("createLogEntry (R5F-2)", () => {
  it("Erfolg: liefert die ID des gespeicherten Eintrags und sendet den Body unverändert", async () => {
    const fetchImpl = fetchReturning(Response.json({ entry: { id: "entry-1", slot: "LUNCH" } }));

    expect(await createLogEntry(payload, fetchImpl)).toEqual({ ok: true, entryId: "entry-1" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/log", expect.objectContaining({ method: "POST", body: JSON.stringify(payload) }));
  });

  it.each([
    ["404 (Rezept nicht gefunden)", Response.json({ error: "Rezept nicht gefunden." }, { status: 404 })],
    ["500 mit HTML-Fehlerseite", new Response("<html>Internal Server Error</html>", { status: 500 })],
    ["Fehlerstatus, obwohl der Body wie ein Eintrag aussieht", Response.json({ entry: { id: "entry-1" } }, { status: 409 })],
  ])("HTTP-Fehler %s: kein Erfolg, Mahlzeit bleibt ungeloggt", async (_label, response) => {
    expect(await createLogEntry(payload, fetchReturning(response))).toEqual({ ok: false, message: LOG_FAILED_MESSAGE });
  });

  it.each([
    ["kein JSON", new Response("ok", { status: 200 })],
    ["ohne Eintrag", Response.json({}, { status: 200 })],
    ["Eintrag ohne ID", Response.json({ entry: {} }, { status: 200 })],
  ])("ungültige Erfolgsantwort (%s): kein falscher Erfolg", async (_label, response) => {
    expect(await createLogEntry(payload, fetchReturning(response))).toEqual({ ok: false, message: LOG_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kein Erfolg, keine Ausnahme", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    expect(await createLogEntry(payload, fetchImpl)).toEqual({ ok: false, message: LOG_FAILED_MESSAGE });
  });
});

describe("deleteLogEntry (R5F-2)", () => {
  it("Erfolg nur mit bestätigter Antwort", async () => {
    const fetchImpl = fetchReturning(Response.json({ ok: true }));

    expect(await deleteLogEntry("entry-1", fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/log?id=entry-1", { method: "DELETE" });
  });

  it("HTTP- oder Netzwerkfehler: kein Erfolg, der Eintrag bleibt in der Anzeige", async () => {
    expect(await deleteLogEntry("entry-1", fetchReturning(Response.json({ error: "Nicht angemeldet." }, { status: 401 })))).toEqual({
      ok: false,
      message: REMOVE_FAILED_MESSAGE,
    });
    expect(await deleteLogEntry("entry-1", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline")))).toEqual({
      ok: false,
      message: REMOVE_FAILED_MESSAGE,
    });
  });
});
