/**
 * Evidence Engine v1 - Kontext-Abgleich für ein einzelnes Freitextfeld
 * (topic/population/trainingContext/trainingType/intensityOrDuration/
 * nutritionContext/timingContext). Bewusst KEINE naive Volltext-/LIKE-Suche
 * über den ganzen Claim, sondern ein strukturierter, pro Feld ausgewerteter
 * Vergleich - siehe scoring.ts für die Zuordnung zu Punkten.
 *
 * Fünf Kategorien (exakt wie fachlich gefordert):
 * - EXACT_MATCH: normalisierte Werte sind identisch.
 * - PARTIAL_MATCH: einer der beiden normalisierten Werte enthält den anderen
 *   (z.B. Kontext "resistance" in Claim-Text "resistance training, 40-min
 *   Bout").
 * - GENERAL: der Claim schränkt dieses Feld nicht ein (Wert ist null) - er
 *   gilt für dieses Feld unabhängig vom Kontext, ist aber kein "Treffer".
 * - CONFLICT: beide Werte sind gesetzt, überschneiden sich aber nicht -
 *   schließt den Claim komplett aus (siehe retrieveEvidence.ts).
 * - UNKNOWN: der Kontext liefert für dieses Feld keinen Wert. Fehlender
 *   Kontext wird NIE als Match interpretiert (weder positiv noch negativ).
 *
 * Der Vergleich ist bewusst simpel (case-insensitive, getrimmt, Teilstring-
 * Enthaltensein) - keine Sprachverarbeitung, kein Scoring-Blackbox-Modell.
 * Das bedeutet: Aufrufer sollten kurze, gezielte Werte übergeben (z.B.
 * "resistance" statt eines ganzen Satzes), sonst können lange, deskriptive
 * Claim-Texte (z.B. `population`) fälschlich als CONFLICT gewertet werden,
 * obwohl sie inhaltlich nicht wirklich widersprüchlich sind. Das ist eine
 * bekannte, dokumentierte Grenze von v1 (siehe Kapitel-Abschlussbericht).
 */

export type EvidenceFieldMatch = "EXACT_MATCH" | "PARTIAL_MATCH" | "GENERAL" | "CONFLICT" | "UNKNOWN";

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function matchContextField(
  contextValue: string | undefined,
  claimValue: string | null,
): EvidenceFieldMatch {
  if (!claimValue || claimValue.trim().length === 0) return "GENERAL";
  if (!contextValue || contextValue.trim().length === 0) return "UNKNOWN";

  const a = normalize(contextValue);
  const b = normalize(claimValue);

  if (a === b) return "EXACT_MATCH";
  if (b.includes(a) || a.includes(b)) return "PARTIAL_MATCH";
  return "CONFLICT";
}
