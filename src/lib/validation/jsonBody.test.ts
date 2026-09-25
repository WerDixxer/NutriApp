import { describe, expect, it } from "vitest";
import { invalidJsonBodyResponse, readJsonBody } from "./jsonBody";

function post(body?: string): Request {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json" }, body });
}

describe("readJsonBody (F-19)", () => {
  it.each([
    ["kaputtes JSON", "{kaputt"],
    ["abgeschnittenes JSON", '{"name": "Reis"'],
    ["leerer Body", ""],
    ["nur Leerzeichen", "   "],
    ["kein JSON, sondern Text", "name=Reis"],
  ])("meldet %s als ungültig, statt zu werfen", async (_label, body) => {
    await expect(readJsonBody(post(body))).resolves.toEqual({ ok: false });
  });

  it("meldet einen fehlenden Body als ungültig", async () => {
    await expect(readJsonBody(post())).resolves.toEqual({ ok: false });
  });

  it.each([
    ["ein Objekt", '{"name":"Reis","quantity":1}', { name: "Reis", quantity: 1 }],
    ["ein leeres Objekt", "{}", {}],
    ["ein Objekt mit fremden Feldern", '{"foo":"bar"}', { foo: "bar" }],
    ["ein Array", "[1,2]", [1, 2]],
    ["null", "null", null],
    ["eine Zahl", "42", 42],
  ])("gibt %s unverändert weiter - ob es inhaltlich passt, entscheidet das Schema der Route", async (_label, body, expected) => {
    await expect(readJsonBody(post(body))).resolves.toEqual({ ok: true, value: expected });
  });

  it("wirft andere Fehler weiter, z. B. einen bereits gelesenen Body (Programmierfehler)", async () => {
    const request = post('{"a":1}');
    await request.text();
    await expect(readJsonBody(request)).rejects.toBeInstanceOf(TypeError);
  });
});

describe("invalidJsonBodyResponse", () => {
  it("antwortet mit 400 im üblichen Fehlerformat, ohne interne Details", async () => {
    const res = invalidJsonBodyResponse();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Ungültige Anfrage: Der Inhalt ist kein gültiges JSON." });
  });
});
