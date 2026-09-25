import { NextResponse } from "next/server";

/**
 * Liest den JSON-Body einer Anfrage, ohne bei kaputtem oder leerem Body abzustürzen (F-19).
 * Prüft nur, ob der Body gültiges JSON ist - ob er inhaltlich passt, entscheidet danach wie
 * bisher das zod-Schema der Route. Andere Fehler als ein JSON-Syntaxfehler (z. B. ein bereits
 * gelesener Body) sind Programmierfehler und werden weitergeworfen.
 */
export async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await request.json() };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false };
    throw error;
  }
}

/** Antwort für einen Body, der kein gültiges JSON ist - im üblichen Fehlerformat der API. */
export function invalidJsonBodyResponse() {
  return NextResponse.json({ error: "Ungültige Anfrage: Der Inhalt ist kein gültiges JSON." }, { status: 400 });
}
