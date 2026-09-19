import { z } from "zod";

/**
 * Evidence Library: Validierung sowohl für kuratierte Seed-Daten (siehe
 * src/lib/evidence/data/) als auch für alles, was später einmal über eine
 * API in die Evidence Library geschrieben werden könnte. Enums spiegeln
 * exakt die Prisma-Enums (schema.prisma), damit nie zwei leicht
 * unterschiedliche Wertemengen nebeneinander existieren.
 *
 * Wichtig: `evidenceStrength` ist bewusst `z.enum(...)`, kein Freitext -
 * ein Wert wie "MODERATE/LIMITED" wird dadurch strukturell abgelehnt, nicht
 * nur per Konvention vermieden.
 */

export const evidenceClaimTypeSchema = z.enum([
  "EVIDENCE_FINDING",
  "AUTHOR_INTERPRETATION",
  "PRACTICAL_RECOMMENDATION",
  "CONTEXTUAL_LIMITATION",
]);

export const evidenceStrengthSchema = z.enum(["HIGH", "MODERATE", "LIMITED", "UNCERTAIN"]);

export const evidenceDirectionSchema = z.enum([
  "INCREASE",
  "DECREASE",
  "MAINTAIN",
  "CONDITIONAL",
  "NO_EFFECT",
]);

export const evidenceClaimStatusSchema = z.enum(["VERIFIED", "PENDING_FULL_TEXT", "REJECTED"]);

export const evidenceAccessTypeSchema = z.enum(["FULL_TEXT", "ABSTRACT_ONLY"]);

export const evidenceSourceInputSchema = z.object({
  citation: z.string().trim().min(1, "Citation fehlt."),
  doi: z.string().trim().min(1, "DOI fehlt."),
  pmid: z.string().trim().min(1).nullable().optional(),
  pmcid: z.string().trim().min(1).nullable().optional(),
  accessedText: evidenceAccessTypeSchema,
});

// Ein leerer String ist für die meisten Freitextfelder kein sinnvoller Wert
// (sollte stattdessen `null`/`undefined` sein) - `.min(1)` erzwingt das,
// statt stillschweigend "" zu persistieren.
const optionalContextField = z.string().trim().min(1).nullable().optional();

export const evidenceClaimInputSchema = z.object({
  claimId: z
    .string()
    .trim()
    .min(1, "claimId fehlt.")
    .regex(/^[A-Z0-9_]+$/, "claimId muss ein stabiler UPPER_SNAKE_CASE-Schlüssel sein."),
  claimType: evidenceClaimTypeSchema,
  topic: z.string().trim().min(1, "topic fehlt."),
  statement: z.string().trim().min(1, "statement fehlt."),
  population: optionalContextField,
  trainingContext: optionalContextField,
  trainingType: optionalContextField,
  intensityOrDuration: optionalContextField,
  nutritionContext: optionalContextField,
  timingContext: optionalContextField,
  direction: evidenceDirectionSchema,
  evidenceStrength: evidenceStrengthSchema,
  limitations: z.array(z.string().trim().min(1)).default([]),
  justification: z.string().trim().min(1, "justification fehlt."),
  status: evidenceClaimStatusSchema,
});

/**
 * Evidence Engine v1: Input-Kontext für `retrieveEvidence()` (siehe
 * src/lib/evidence/engine/). Bewusst KEIN neuer, paralleler Kontext-Typ -
 * die Felder spiegeln exakt die bestehenden `EvidenceClaim`-Spalten
 * (topic/population/trainingContext/trainingType/intensityOrDuration/
 * nutritionContext/timingContext/direction), gegen die direkt gematcht wird.
 * Es existiert bewusst KEINE Übernahme von `SportType`/`TrainingSession`/
 * `MealSlot` (Profile/Decision-Engine/MealPlanner) hier: diese sind
 * strukturierte, DB-relationale Enums, während die Evidence-Claim-Felder
 * kuratierter Freitext sind (siehe kerksick2017.ts, z.B.
 * `trainingType: "resistance"`) - es gibt keine automatische, semantische
 * Zuordnung zwischen beiden Welten. Die explizite, deterministische
 * Mapping-Schicht dafür liegt in src/lib/evidence/context/
 * (mapSportType/mapTrainingSessionToEvidenceContext/
 * mapMealSlotToTimingContext) - sie füllt genau die Felder unten, die sie
 * mit Sicherheit befüllen kann, und liefert sonst bewusst `undefined`.
 *
 * Alle Felder optional: fehlender Kontext ist ausdrücklich erlaubt (siehe
 * contextMatching.ts - fehlende Werte werden als "UNKNOWN" behandelt, nie
 * automatisch als Match). Keine medizinischen/personenbezogenen
 * Gesundheitsfelder.
 */
export const evidenceContextSchema = z.object({
  topic: z.string().trim().min(1).optional(),
  population: z.string().trim().min(1).optional(),
  trainingContext: z.string().trim().min(1).optional(),
  trainingType: z.string().trim().min(1).optional(),
  intensityOrDuration: z.string().trim().min(1).optional(),
  nutritionContext: z.string().trim().min(1).optional(),
  timingContext: z.string().trim().min(1).optional(),
  direction: evidenceDirectionSchema.optional(),
  /**
   * Evidence Context Mapping v1 (Kapitel "Evidence Context Mapping /
   * Ontology"): strukturierte, numerische Trainingsdauer in Minuten.
   *
   * Warum nötig: `intensityOrDuration` ist Freitext (z.B. "≥70% VO2max,
   * >90 min"). Eine numerische Dauer (z.B. 90) einfach als String ("90 min")
   * in `intensityOrDuration` zu schreiben und über den bestehenden
   * Teilstring-Vergleich (contextMatching.ts) gegen ">90 min" zu matchen,
   * wäre IRREFÜHREND: "90 min" ist zufällig ein Teilstring von ">90 min",
   * obwohl 90 die Schwelle ">90" gerade NICHT erfüllt - ein falscher,
   * scheinbar exakter Match. Deshalb ein eigenes, strukturiertes Feld statt
   * einer Freitext-Krücke.
   *
   * Quelle: `TrainingSession.durationMin` (schema.prisma), durchgereicht via
   * `mapTrainingSessionToEvidenceContext()` (src/lib/evidence/context/mapTraining.ts).
   *
   * Aktueller Stand: wird von der Evidence Engine v1 (engine/scoring.ts)
   * NOCH NICHT ausgewertet - dafür müsste zuerst aus den Claim-Freitexten
   * (z.B. ">90 min", ">70 min") eine echte numerische Schwellen-Semantik
   * (Operator + Wert + Einheit) extrahiert werden. Das ist bewusst NICHT
   * Teil dieses Kapitels (siehe Kapitel-Abschlussbericht, offener Punkt) -
   * das Feld wird hier nur sauber vorbereitet und durchgereicht, damit eine
   * künftige Engine-Erweiterung es nutzen kann, ohne das Schema erneut
   * ändern zu müssen.
   */
  trainingDurationMin: z.number().int().positive().optional(),
});

export type EvidenceContext = z.infer<typeof evidenceContextSchema>;

export type EvidenceSourceInput = z.infer<typeof evidenceSourceInputSchema>;
export type EvidenceClaimInput = z.infer<typeof evidenceClaimInputSchema>;
export type EvidenceClaimType = z.infer<typeof evidenceClaimTypeSchema>;
export type EvidenceStrength = z.infer<typeof evidenceStrengthSchema>;
export type EvidenceDirection = z.infer<typeof evidenceDirectionSchema>;
export type EvidenceClaimStatus = z.infer<typeof evidenceClaimStatusSchema>;
export type EvidenceAccessType = z.infer<typeof evidenceAccessTypeSchema>;
