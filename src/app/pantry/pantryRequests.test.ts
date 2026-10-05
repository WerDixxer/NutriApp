import { describe, expect, it, vi } from "vitest";
import { ADJUST_FAILED_MESSAGE, adjustPantryQuantity, DELETE_FAILED_MESSAGE, deletePantryItem } from "./pantryRequests";

const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
const offline = () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

describe("deletePantryItem (R5F-3)", () => {
  it("Erfolg nur mit bestätigter Antwort", async () => {
    const fetchImpl = respond(Response.json({ ok: true }));

    expect(await deletePantryItem("item-1", fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("/api/pantry/item-1", { method: "DELETE" });
  });

  it.each([
    ["404", Response.json({ error: "Nicht gefunden." }, { status: 404 })],
    ["500", new Response("<html>Fehler</html>", { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, der Vorrat bleibt in der Anzeige", async (_label, response) => {
    expect(await deletePantryItem("item-1", respond(response))).toEqual({ ok: false, message: DELETE_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    expect(await deletePantryItem("item-1", offline())).toEqual({ ok: false, message: DELETE_FAILED_MESSAGE });
  });
});

describe("adjustPantryQuantity (R5F-3)", () => {
  it("Erfolg: liefert die neue Restmenge aus der Antwort und sendet Art und Menge", async () => {
    const fetchImpl = respond(Response.json({ item: { id: "item-1", remainingQuantity: 350 } }));

    expect(await adjustPantryQuantity("item-1", "consume", 150, fetchImpl)).toEqual({ ok: true, remainingQuantity: 350 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/pantry/item-1/adjust",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ type: "consume", amount: 150 }) }),
    );
  });

  it.each([
    ["400 (z.B. mehr verbraucht als vorhanden)", Response.json({ error: "Ungültige Menge." }, { status: 400 })],
    ["Fehlerstatus, obwohl der Body eine Menge enthält", Response.json({ item: { remainingQuantity: 0 } }, { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, Menge bleibt", async (_label, response) => {
    expect(await adjustPantryQuantity("item-1", "add", 100, respond(response))).toEqual({ ok: false, message: ADJUST_FAILED_MESSAGE });
  });

  it.each([
    ["kein JSON", new Response("ok", { status: 200 })],
    ["ohne Restmenge", Response.json({ item: {} })],
  ])("ungültige Erfolgsantwort (%s): kein falscher Erfolg", async (_label, response) => {
    expect(await adjustPantryQuantity("item-1", "add", 100, respond(response))).toEqual({ ok: false, message: ADJUST_FAILED_MESSAGE });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    expect(await adjustPantryQuantity("item-1", "add", 100, offline())).toEqual({ ok: false, message: ADJUST_FAILED_MESSAGE });
  });
});
