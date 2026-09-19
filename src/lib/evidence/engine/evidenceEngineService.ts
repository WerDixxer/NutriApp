import { evidenceContextSchema } from "../../validation/evidence";
import { listEvidenceClaims } from "../evidenceService";
import { toEvidenceClaimView } from "../evidenceClaimView";
import { retrieveEvidence } from "./retrieveEvidence";
import type { EvidenceRetrievalResult } from "./types";

/**
 * Einziger DB-berührender Einstiegspunkt der Evidence Engine. Bewusst OHNE
 * householdId/userId/profileId-Parameter (wie evidenceService.ts) - die
 * Evidence Library bleibt global, ein Retrieval-Aufruf hat keinen
 * Nutzerbezug und kann daher auch keinen Household-/User-Scope versehentlich
 * mutieren oder filtern.
 *
 * `rawContext: unknown`, damit Zod hier tatsächlich greift (nicht nur als
 * ungenutztes Schema danebenliegt) - validiert exakt den in Kapitel-Vorgabe
 * geforderten Input-Typ, bevor die reine `retrieveEvidence()`-Kernlogik
 * läuft.
 */
export async function retrieveEvidenceForContext(rawContext: unknown): Promise<EvidenceRetrievalResult> {
  const context = evidenceContextSchema.parse(rawContext);
  const rows = await listEvidenceClaims();
  const claims = rows.map(toEvidenceClaimView);
  return retrieveEvidence(context, claims);
}
