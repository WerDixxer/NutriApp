import type { listEvidenceClaims } from "./evidenceService";
import type {
  EvidenceAccessType,
  EvidenceClaimStatus,
  EvidenceClaimType,
  EvidenceDirection,
  EvidenceStrength,
} from "../validation/evidence";

/**
 * Domain-Sicht auf einen `EvidenceClaim`-DB-Datensatz (wie `dbRecipeToSearchable`
 * in agents/searchableRecipe.ts): parst `limitations` aus dem als JSON-String
 * gespeicherten Feld (SQLite kennt keine nativen Arrays, siehe schema.prisma-
 * Kommentar) in ein echtes `string[]`, damit die Evidence Engine (und alles,
 * was später darauf aufbaut) nie selbst JSON.parse aufrufen muss.
 *
 * Bewusst eine eigene, von Prisma entkoppelte Form: die Evidence Engine
 * (src/lib/evidence/engine/) operiert ausschließlich auf `EvidenceClaimView`,
 * nie auf rohen Prisma-Zeilen - das macht ihre Kernlogik mit einfachen
 * Objektliteralen testbar, ganz ohne Datenbank/Mocking (siehe
 * engine/retrieveEvidence.test.ts).
 */
export interface EvidenceSourceView {
  citation: string;
  doi: string;
  pmid: string | null;
  pmcid: string | null;
  accessedText: EvidenceAccessType;
}

export interface EvidenceClaimView {
  claimId: string;
  claimType: EvidenceClaimType;
  topic: string;
  statement: string;
  population: string | null;
  trainingContext: string | null;
  trainingType: string | null;
  intensityOrDuration: string | null;
  nutritionContext: string | null;
  timingContext: string | null;
  direction: EvidenceDirection;
  evidenceStrength: EvidenceStrength;
  limitations: string[];
  justification: string;
  status: EvidenceClaimStatus;
  source: EvidenceSourceView;
}

export type EvidenceClaimRow = Awaited<ReturnType<typeof listEvidenceClaims>>[number];

export function toEvidenceClaimView(row: EvidenceClaimRow): EvidenceClaimView {
  return {
    claimId: row.claimId,
    claimType: row.claimType,
    topic: row.topic,
    statement: row.statement,
    population: row.population,
    trainingContext: row.trainingContext,
    trainingType: row.trainingType,
    intensityOrDuration: row.intensityOrDuration,
    nutritionContext: row.nutritionContext,
    timingContext: row.timingContext,
    direction: row.direction,
    evidenceStrength: row.evidenceStrength,
    limitations: JSON.parse(row.limitations) as string[],
    justification: row.justification,
    status: row.status,
    source: {
      citation: row.source.citation,
      doi: row.source.doi,
      pmid: row.source.pmid,
      pmcid: row.source.pmcid,
      accessedText: row.source.accessedText,
    },
  };
}
