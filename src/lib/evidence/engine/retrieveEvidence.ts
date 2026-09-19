import type { EvidenceContext } from "../../validation/evidence";
import type { EvidenceClaimView } from "../evidenceClaimView";
import { evaluateClaim } from "./scoring";
import type { EvidenceRetrievalResult } from "./types";

/**
 * Evidence Engine v1 - reine, deterministische Retrieval-Funktion.
 *
 * Architektur (bewusst in dieser Reihenfolge, siehe Kapitel-Vorgabe):
 *
 *   Evidence Library -> Evidence Engine -> relevante Evidenz -> Nutri-Coach
 *   Decision Layer -> Empfehlung
 *
 * NICHT: Evidence Engine -> Empfehlung. Diese Funktion beantwortet
 * ausschließlich "welche vorhandenen Claims sind für diesen Kontext
 * relevant und warum", nie "was soll der Nutzer tun". Eine spätere Decision
 * Layer verbraucht `EvidenceRetrievalResult`, produziert daraus aber ihre
 * eigene Empfehlung (inkl. Recommendation Confidence, Labels wie
 * `EVIDENCE_SUPPORTED`/`HEURISTIC`/... - siehe engine/types.ts) - das ist
 * hier bewusst NICHT implementiert.
 *
 * Traceability: jeder zurückgegebene Claim trägt seine vollständige Source
 * (`RetrievedEvidence.source`, inkl. `doi`/`pmid`/`pmcid`), damit eine
 * spätere Recommendation IMMER bis zur Originalquelle zurückverfolgbar
 * bleibt (Recommendation -> EvidenceClaim -> EvidenceSource -> DOI/PMID/
 * PMCID).
 *
 * Reine Funktion ohne DB-Zugriff (siehe evidenceEngineService.ts für den
 * dünnen asynchronen Wrapper, der Claims aus der bestehenden
 * `evidenceService.listEvidenceClaims()` lädt) - macht sie einfach mit
 * reinen Objektliteralen testbar und garantiert Determinismus: derselbe
 * Input liefert immer dasselbe Ergebnis.
 */
export function retrieveEvidence(context: EvidenceContext, claims: EvidenceClaimView[]): EvidenceRetrievalResult {
  const relevant: EvidenceRetrievalResult["relevant"] = [];
  const excluded: EvidenceRetrievalResult["excluded"] = [];

  for (const claim of claims) {
    const evaluation = evaluateClaim(context, claim);

    if (evaluation.relevant) {
      relevant.push({
        claim,
        source: claim.source,
        relevanceScore: evaluation.relevanceScore,
        // "verified source" wird bewusst NICHT gescored (status ist eine
        // Zulassungsvoraussetzung, kein Relevanz-Faktor), aber als
        // nachvollziehbarer Grund immer mit ausgegeben.
        matchReasons: [...evaluation.matchReasons, "verified source"],
      });
    } else {
      excluded.push({ claim, excludedBecause: evaluation.excludedBecause as string });
    }
  }

  // Deterministische, stabile Sortierung: höchster Score zuerst, bei
  // Gleichstand alphabetisch nach claimId - nie von Objekt-Insertion-Order
  // oder Map-Iteration abhängig.
  relevant.sort((a, b) => b.relevanceScore - a.relevanceScore || a.claim.claimId.localeCompare(b.claim.claimId));

  return { relevant, excluded };
}
