import { prisma } from "../db";
import type { EvidenceClaimInput, EvidenceSourceInput } from "../validation/evidence";

/**
 * Evidence Library: bewusst OHNE householdId/profileId-Parameter in jeder
 * Funktion (anders als pantryService.ts/budgetService.ts/householdService.ts)
 * - Evidence Sources/Claims sind globale, nicht nutzerspezifische
 * Referenzdaten (siehe schema.prisma-Kommentar bei EvidenceSource). Es gibt
 * dadurch keine Stelle, an der ein Household-/User-Scope diese Daten
 * versehentlich filtern oder mutieren könnte.
 *
 * Upserts laufen über die fachlichen Schlüssel `doi` (Source) bzw. `claimId`
 * (Claim), nie über die interne `id` - das macht den Seed idempotent:
 * mehrfaches Ausführen aktualisiert bestehende Zeilen, statt Duplikate zu
 * erzeugen.
 */

export function upsertEvidenceSource(input: EvidenceSourceInput) {
  const data = {
    citation: input.citation,
    pmid: input.pmid ?? null,
    pmcid: input.pmcid ?? null,
    accessedText: input.accessedText,
  };
  return prisma.evidenceSource.upsert({
    where: { doi: input.doi },
    update: data,
    create: { ...data, doi: input.doi },
  });
}

export function upsertEvidenceClaim(sourceId: string, input: EvidenceClaimInput) {
  const data = {
    sourceId,
    claimType: input.claimType,
    topic: input.topic,
    statement: input.statement,
    population: input.population ?? null,
    trainingContext: input.trainingContext ?? null,
    trainingType: input.trainingType ?? null,
    intensityOrDuration: input.intensityOrDuration ?? null,
    nutritionContext: input.nutritionContext ?? null,
    timingContext: input.timingContext ?? null,
    direction: input.direction,
    evidenceStrength: input.evidenceStrength,
    limitations: JSON.stringify(input.limitations),
    justification: input.justification,
    status: input.status,
  };
  return prisma.evidenceClaim.upsert({
    where: { claimId: input.claimId },
    update: data,
    create: { ...data, claimId: input.claimId },
  });
}

export function getEvidenceSourceByDoi(doi: string) {
  return prisma.evidenceSource.findUnique({ where: { doi } });
}

export function listEvidenceClaims() {
  return prisma.evidenceClaim.findMany({
    include: { source: true },
    orderBy: { claimId: "asc" },
  });
}

export function getEvidenceClaimByClaimId(claimId: string) {
  return prisma.evidenceClaim.findUnique({
    where: { claimId },
    include: { source: true },
  });
}
