import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  JsonColumnError,
  parseJsonText,
  parseJsonWithSchema,
  readJsonColumn,
  skipUnreadableRows,
} from "./jsonColumn";

const ref = { model: "Recipe", id: "r1", column: "ingredients" };
const stringList = z.array(z.string());
const person = z.object({ name: z.string(), age: z.number() });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseJsonText", () => {
  it.each([
    ["ein Array", '["a","b"]', ["a", "b"]],
    ["ein Objekt", '{"a":1}', { a: 1 }],
    ["null", "null", null],
  ])("gibt %s geparst zurück", (_label, text, expected) => {
    expect(parseJsonText(text)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ["kaputtes JSON", "[kaputt"],
    ["abgeschnittenes JSON", '["a",'],
    ["leeren Text", ""],
    ["Freitext", "Reis, Bohnen"],
  ])("meldet %s als invalid-json, statt zu werfen", (_label, text) => {
    expect(parseJsonText(text)).toEqual({ ok: false, reason: "invalid-json" });
  });
});

describe("parseJsonWithSchema", () => {
  it("liefert gültiges JSON in passender Form", () => {
    expect(parseJsonWithSchema('{"name":"Ada","age":36}', person)).toEqual({ ok: true, value: { name: "Ada", age: 36 } });
  });

  it("meldet syntaktisch ungültiges JSON als invalid-json", () => {
    expect(parseJsonWithSchema('{"name":', person)).toEqual({ ok: false, reason: "invalid-json" });
  });

  it("meldet gültiges JSON mit falscher Struktur als invalid-shape", () => {
    const result = parseJsonWithSchema('{"name":"Ada"}', stringList);
    expect(result).toMatchObject({ ok: false, reason: "invalid-shape" });
  });

  it("meldet fehlende Felder mit Pfad", () => {
    const result = parseJsonWithSchema('{"name":"Ada"}', person);
    expect(result).toMatchObject({ ok: false, reason: "invalid-shape" });
    expect(result.ok ? "" : "issue" in result ? result.issue : "").toMatch(/^age: /);
  });

  it("meldet inkompatible Werte (falscher Elementtyp) mit Pfad", () => {
    const result = parseJsonWithSchema('["a", 2]', stringList);
    expect(result.ok ? "" : "issue" in result ? result.issue : "").toMatch(/^1: /);
  });
});

describe("readJsonColumn", () => {
  it("liefert den geprüften Wert", () => {
    expect(readJsonColumn(ref, '["100 g Reis"]', stringList)).toEqual(["100 g Reis"]);
  });

  it("wirft bei ungültigem JSON einen JsonColumnError mit Modell, ID und Spalte", () => {
    const error = captureError(() => readJsonColumn(ref, "[kaputt", stringList));
    expect(error).toBeInstanceOf(JsonColumnError);
    expect(error).toMatchObject({ model: "Recipe", recordId: "r1", column: "ingredients", reason: "invalid-json" });
    expect(error.message).toBe('Recipe r1: Spalte "ingredients" enthält kein gültiges JSON.');
  });

  it("wirft bei falscher Form einen JsonColumnError mit reason invalid-shape", () => {
    const error = captureError(() => readJsonColumn(ref, '{"a":1}', stringList));
    expect(error).toMatchObject({ reason: "invalid-shape" });
    expect(error.message).toMatch(/^Recipe r1: Spalte "ingredients" hat nicht die erwartete Form \(.+\)\.$/);
  });

  it("nennt in der Fehlermeldung nie den gespeicherten Inhalt", () => {
    const secretLike = '["sk-ant-geheim-123", 42]';
    const error = captureError(() => readJsonColumn(ref, secretLike, stringList));
    expect(error.message).not.toContain("sk-ant-geheim-123");
    expect(error.message).not.toContain("42");
    const broken = captureError(() => readJsonColumn(ref, "sk-ant-geheim-123", stringList));
    expect(broken.message).not.toContain("sk-ant-geheim-123");
  });
});

describe("skipUnreadableRows", () => {
  const rows = [
    { id: "a", data: '["x"]' },
    { id: "b", data: "[kaputt" },
    { id: "c", data: '{"falsch":true}' },
    { id: "d", data: '["y"]' },
  ];
  const read = (row: (typeof rows)[number]) => readJsonColumn({ model: "Recipe", id: row.id, column: "data" }, row.data, stringList);

  it("lässt nur Zeilen mit unlesbarer JSON-Spalte aus und warnt je Zeile mit ID und Spalte", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(skipUnreadableRows(rows, read)).toEqual([["x"], ["y"]]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0][0]).toContain('Recipe b: Spalte "data"');
    expect(warn.mock.calls[1][0]).toContain('Recipe c: Spalte "data"');
  });

  it("wirft andere Fehler weiter, statt sie zu verschlucken", () => {
    expect(() =>
      skipUnreadableRows([1], () => {
        throw new TypeError("Programmierfehler");
      }),
    ).toThrow(TypeError);
  });
});

function captureError(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Es wurde kein Fehler geworfen.");
}
