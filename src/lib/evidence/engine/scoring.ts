import type { EvidenceContext } from "../../validation/evidence";
import type { EvidenceClaimView } from "../evidenceClaimView";
import { matchContextField } from "./contextMatching";
import type { EvidenceFactorResult } from "./types";

/**
 * Evidence Engine v1 - deterministischer, vollständig dokumentierter
 * Relevance Score. Kein ML, kein LLM, keine versteckte Gewichtung: jeder
 * Punktwert ist eine feste Konstante unten in `CONTEXT_FIELDS`/
 * `EVIDENCE_STRENGTH_POINTS`, jeder Beitrag ist über `matchReasons`
 * nachvollziehbar.
 *
 * Punktetabelle (== die einzige Stelle, die Gewichte vergibt):
 *   + exact topic match             3
 *   + partial topic match           2
 *   + exact training type/context/  2
 *     intensity/nutrition/timing
 *     match
 *   + partial training type/...     1
 *   + general (Claim gilt          1 (topic ausgenommen: topic ist bei
 *     unabhängig von diesem Feld)     jedem Claim gesetzt, "general" kommt
 *                                     für topic daher nie vor)
 *   + exact/partial population      1 (Population-Angaben sind meist lange,
 *     match / general population      deskriptive Sätze - bewusst niedrig
 *                                     gewichtet, siehe contextMatching.ts)
 *   + direction match                1 (nur Bonus, siehe unten)
 *   + evidenceStrength HIGH          2
 *   + evidenceStrength MODERATE      1
 *   + evidenceStrength LIMITED/      0
 *     UNCERTAIN
 *   - (kein Punktabzug) CONFLICT auf irgendeinem Feld schließt den Claim
 *     komplett aus (siehe retrieveEvidence.ts) - der Score wird für
 *     ausgeschlossene Claims gar nicht erst berechnet.
 *
 * WICHTIG: `evidenceStrength` ist nur EIN Faktor unter mehreren und trägt
 * bewusst wenige Punkte bei (max. 2 von i.d.R. 8-15 möglichen Punkten) -
 * der Score ist NICHT mit `evidenceStrength` gleichzusetzen. Ein LIMITED-
 * Claim mit exaktem Topic-/Trainingstyp-Match kann einen höheren Score
 * erzielen als ein HIGH-Claim ohne jeden Kontextbezug.
 *
 * `direction` verhält sich bewusst ANDERS als die übrigen Felder: eine
 * abweichende `direction` (z.B. Claim sagt NO_EFFECT, Kontext fragt nach
 * INCREASE) ist KEIN Konflikt, der den Claim ausschließt - im Gegenteil,
 * genau das ist oft die wertvollste Evidenz (ein Claim, der eine Annahme
 * widerlegt, bleibt relevant). `direction` liefert daher nur einen kleinen
 * Bonus bei Übereinstimmung, nie einen Ausschlussgrund.
 */

interface ContextFieldConfig {
  key: keyof EvidenceContext & keyof EvidenceClaimView;
  label: string;
  exactPoints: number;
  partialPoints: number;
  generalPoints: number;
}

export const CONTEXT_FIELDS: ContextFieldConfig[] = [
  { key: "topic", label: "topic", exactPoints: 3, partialPoints: 2, generalPoints: 0 },
  { key: "trainingType", label: "training type", exactPoints: 2, partialPoints: 1, generalPoints: 1 },
  { key: "trainingContext", label: "training context", exactPoints: 2, partialPoints: 1, generalPoints: 1 },
  { key: "intensityOrDuration", label: "intensity/duration", exactPoints: 2, partialPoints: 1, generalPoints: 1 },
  { key: "nutritionContext", label: "nutrition context", exactPoints: 2, partialPoints: 1, generalPoints: 1 },
  { key: "timingContext", label: "timing context", exactPoints: 2, partialPoints: 1, generalPoints: 1 },
  { key: "population", label: "population", exactPoints: 1, partialPoints: 1, generalPoints: 1 },
];

const EVIDENCE_STRENGTH_POINTS: Record<EvidenceClaimView["evidenceStrength"], number> = {
  HIGH: 2,
  MODERATE: 1,
  LIMITED: 0,
  UNCERTAIN: 0,
};

const DIRECTION_MATCH_POINTS = 1;

export interface ClaimEvaluation {
  relevant: boolean;
  excludedBecause?: string;
  relevanceScore: number;
  matchReasons: string[];
}

/**
 * Bewertet GENAU EINEN Claim gegen den übergebenen Kontext. Reine Funktion:
 * gleicher Input liefert immer dasselbe Ergebnis, keine Seiteneffekte, keine
 * Zufallskomponente.
 */
export function evaluateClaim(context: EvidenceContext, claim: EvidenceClaimView): ClaimEvaluation {
  if (claim.status !== "VERIFIED") {
    return {
      relevant: false,
      excludedBecause: `status ist ${claim.status}, nicht VERIFIED`,
      relevanceScore: 0,
      matchReasons: [],
    };
  }

  const factorResults: EvidenceFactorResult[] = [];
  // true, sobald der Kontext mindestens EIN tatsächlich angefragtes Feld
  // beigesteuert hat, das entweder trifft oder allgemein gilt - verhindert,
  // dass ein komplett leerer Kontext ({}) trivial "relevant" für jeden Claim
  // wird (jedes Feld wäre sonst nur UNKNOWN, s.u.).
  let hasEngagedField = false;

  for (const field of CONTEXT_FIELDS) {
    const contextValue = context[field.key] as string | undefined;
    const claimValue = (claim[field.key] ?? null) as string | null;
    const category = matchContextField(contextValue, claimValue);

    if (category === "CONFLICT") {
      return {
        relevant: false,
        excludedBecause: `Kontextkonflikt bei "${field.label}": Kontext "${contextValue}" vs. Claim "${claimValue}"`,
        relevanceScore: 0,
        matchReasons: [],
      };
    }

    if (category === "EXACT_MATCH") {
      factorResults.push({
        factor: field.label,
        points: field.exactPoints,
        reason: `exact ${field.label} match: "${claimValue}"`,
      });
      hasEngagedField = true;
    } else if (category === "PARTIAL_MATCH") {
      factorResults.push({
        factor: field.label,
        points: field.partialPoints,
        reason: `partial ${field.label} match: "${contextValue}" ~ "${claimValue}"`,
      });
      hasEngagedField = true;
    } else if (category === "GENERAL" && contextValue) {
      // Nur zählen, wenn der Kontext dieses Feld überhaupt angefragt hat -
      // sonst wäre "general" für jedes nie angefragte Feld trivial wahr.
      factorResults.push({
        factor: field.label,
        points: field.generalPoints,
        reason: `${field.label}: claim gilt allgemein, kein Widerspruch zu "${contextValue}"`,
      });
      hasEngagedField = true;
    }
    // GENERAL ohne contextValue und UNKNOWN tragen bewusst nichts bei - kein
    // erfundener reason für ein Feld, zu dem der Kontext nichts beisteuert.
  }

  if (context.direction && context.direction === claim.direction) {
    factorResults.push({
      factor: "direction",
      points: DIRECTION_MATCH_POINTS,
      reason: `direction match: ${claim.direction}`,
    });
    hasEngagedField = true;
  }

  if (!hasEngagedField) {
    return {
      relevant: false,
      excludedBecause: "Kein angefragtes Kontextfeld ergab einen Treffer oder eine allgemeine Anwendbarkeit",
      relevanceScore: 0,
      matchReasons: [],
    };
  }

  const strengthPoints = EVIDENCE_STRENGTH_POINTS[claim.evidenceStrength];
  factorResults.push({
    factor: "evidenceStrength",
    points: strengthPoints,
    reason:
      strengthPoints > 0
        ? `evidenceStrength ${claim.evidenceStrength} trägt zusätzlich zur Relevanz bei (ersetzt NICHT die Kontextprüfung)`
        : undefined,
  });

  const relevanceScore = factorResults.reduce((sum, f) => sum + f.points, 0);
  const matchReasons = factorResults.filter((f) => f.reason).map((f) => f.reason as string);

  return { relevant: true, relevanceScore, matchReasons };
}
