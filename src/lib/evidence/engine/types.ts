import type { EvidenceClaimView } from "../evidenceClaimView";

/**
 * Ein einzelner, nachvollziehbarer Beitrag zum `relevanceScore` eines Claims
 * (gleiches Muster wie `FactorResult` in agents/decision/softScoring.ts und
 * `RotationFactorResult` in rotation/factors.ts): ein Name, ein Punktwert,
 * optional ein für Menschen lesbarer Grund - NIE ein erfundener `reason` für
 * einen Faktor, der tatsächlich nichts beigetragen hat.
 */
export interface EvidenceFactorResult {
  factor: string;
  points: number;
  reason?: string;
}

/**
 * Ein Claim, der für den übergebenen `EvidenceContext` als relevant gilt.
 * `relevanceScore` ist AUSSCHLIESSLICH ein Retrieval-/Sortierhinweis - er
 * ist NICHT mit `claim.evidenceStrength` gleichzusetzen und erst recht keine
 * "Recommendation Confidence" (die entsteht frühestens in einer späteren
 * Decision Layer, siehe Architektur-Kommentar in retrieveEvidence.ts).
 */
export interface RetrievedEvidence {
  claim: EvidenceClaimView;
  source: EvidenceClaimView["source"];
  relevanceScore: number;
  matchReasons: string[];
}

/** Ein Claim, der NICHT zurückgegeben wurde, mit dem exakten Ausschlussgrund. */
export interface ExcludedEvidence {
  claim: EvidenceClaimView;
  excludedBecause: string;
}

export interface EvidenceRetrievalResult {
  relevant: RetrievedEvidence[];
  excluded: ExcludedEvidence[];
}

/**
 * Labels einer KÜNFTIGEN Decision Layer (Nutri-Coach), NICHT der Evidence
 * Engine selbst. Hier nur als Typ vorbereitet, damit eine spätere Decision
 * Layer denselben Wortschatz verwendet statt eigene, abweichende Labels zu
 * erfinden - die Evidence Engine v1 vergibt dieses Label an KEINER Stelle
 * und leitet daraus auch keine Empfehlung ab (siehe Architektur-Kommentar in
 * retrieveEvidence.ts: Evidence Engine -> relevante Evidenz -> Decision
 * Layer -> Empfehlung, nie Evidence Engine -> Empfehlung direkt).
 */
export type FutureRecommendationLabel =
  | "EVIDENCE_SUPPORTED"
  | "HEURISTIC"
  | "USER_PREFERENCE"
  | "INSUFFICIENT_EVIDENCE";
