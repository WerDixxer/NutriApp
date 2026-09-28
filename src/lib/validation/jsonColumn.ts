import type { z } from "zod";
import { firstZodIssue } from "./zodError";

/**
 * Zentrales Lesen von JSON, das als Text gespeichert ist (R5D) - vor allem die JSON-Spalten der
 * SQLite-Datenbank (schema.prisma: Listen wie `Recipe.ingredients` liegen als JSON-String vor).
 *
 * Statt `JSON.parse(text) as T` an jeder Stelle wird der Text hier einmal geparst UND per zod-Schema
 * auf die erwartete Form geprüft. Ein kaputter oder unerwartet geformter Datensatz führt so nicht zu
 * einem beliebigen `TypeError` irgendwo später, sondern zu einem benannten Fehler, der Modell,
 * Datensatz-ID und Spalte nennt. Es wird nichts repariert und nichts zurückgeschrieben.
 *
 * Request-Bodies liest weiterhin `readJsonBody` (jsonBody.ts); dort entscheidet das Schema der Route.
 */

export type JsonTextFailureReason = "invalid-json" | "invalid-shape";

export type JsonTextResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid-json" }
  | { ok: false; reason: "invalid-shape"; issue: string };

/** Parst JSON-Text, ohne zu werfen. Prüft nur die Syntax, nicht die Form. */
export function parseJsonText(text: string): JsonTextResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, reason: "invalid-json" };
    throw error;
  }
}

/** Parst JSON-Text und prüft ihn gegen `schema`, ohne zu werfen. */
export function parseJsonWithSchema<S extends z.ZodType>(text: string, schema: S): JsonTextResult<z.output<S>> {
  const parsed = parseJsonText(text);
  if (!parsed.ok) return parsed;
  const validated = schema.safeParse(parsed.value);
  if (!validated.success) return { ok: false, reason: "invalid-shape", issue: firstZodIssue(validated.error) };
  return { ok: true, value: validated.data };
}

/** Woher ein JSON-Text stammt - nur Bezeichner, nie der Inhalt selbst. */
export interface JsonColumnRef {
  model: string;
  id: string;
  column: string;
}

/**
 * Eine gespeicherte JSON-Spalte ist unlesbar. Die Meldung nennt nur Modell, ID, Spalte und bei
 * falscher Form die erste zod-Meldung (erwarteter Typ/Pfad) - nie den gespeicherten Wert, damit
 * keine Nutzerdaten oder Secrets in Logs landen.
 */
export class JsonColumnError extends Error {
  readonly model: string;
  readonly recordId: string;
  readonly column: string;
  readonly reason: JsonTextFailureReason;

  constructor(ref: JsonColumnRef, failure: Exclude<JsonTextResult<unknown>, { ok: true }>) {
    const detail =
      failure.reason === "invalid-json" ? "enthält kein gültiges JSON" : `hat nicht die erwartete Form (${failure.issue})`;
    super(`${ref.model} ${ref.id}: Spalte "${ref.column}" ${detail}.`);
    this.name = "JsonColumnError";
    this.model = ref.model;
    this.recordId = ref.id;
    this.column = ref.column;
    this.reason = failure.reason;
  }
}

/** Liest eine gespeicherte JSON-Spalte in der von `schema` beschriebenen Form; wirft sonst `JsonColumnError`. */
export function readJsonColumn<S extends z.ZodType>(ref: JsonColumnRef, text: string, schema: S): z.output<S> {
  const parsed = parseJsonWithSchema(text, schema);
  if (!parsed.ok) throw new JsonColumnError(ref, parsed);
  return parsed.value;
}

/** Einheitliche Warnung für einen unlesbaren Datensatz, der bewusst übergangen wird. */
export function reportUnreadableJsonColumn(error: JsonColumnError, consequence: string): void {
  console.warn(`[json-column] ${error.message} ${consequence}`);
}

/**
 * Wendet `map` auf jede Zeile an und lässt Zeilen mit unlesbarer JSON-Spalte (nur `JsonColumnError`)
 * mit Warnung aus. Gedacht für Kandidaten-Pools (z.B. alle Rezepte für die Planung), in denen ein
 * einzelner kaputter Datensatz nicht den ganzen Request scheitern lassen soll. Andere Fehler werden
 * weitergeworfen.
 */
export function skipUnreadableRows<Row, T>(rows: readonly Row[], map: (row: Row) => T): T[] {
  const result: T[] = [];
  for (const row of rows) {
    try {
      result.push(map(row));
    } catch (error) {
      if (!(error instanceof JsonColumnError)) throw error;
      reportUnreadableJsonColumn(error, "Datensatz wird übersprungen.");
    }
  }
  return result;
}
