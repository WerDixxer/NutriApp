import { describe, expect, it } from "vitest";
import { kerksick2017Claims, kerksick2017Source } from "../data/kerksick2017";
import type { EvidenceClaimView, EvidenceSourceView } from "../evidenceClaimView";
import { retrieveEvidence } from "../engine/retrieveEvidence";
import { mapSportType, mapTrainingSessionToEvidenceContext } from "./mapTraining";

/**
 * Integrationstest über die volle Kette:
 *   TrainingSession -> Context Mapping -> EvidenceContext -> Evidence Engine
 *   -> RetrievedEvidence
 *
 * Verwendet bewusst die ECHTEN, bereits kuratierten und verifizierten
 * Kerksick-Claims (kerksick2017.ts) statt erfundener Test-Fixtures - siehe
 * Kapitel-Vorgabe "ausschließlich bestehende reale/seeded Evidence Claims".
 * Läuft ohne echte DB (die Claims werden hier lokal in die von der Engine
 * erwartete `EvidenceClaimView`-Form gebracht, exakt wie es
 * `toEvidenceClaimView()` für echte DB-Zeilen tut) - deterministisch,
 * schnell, unabhängig vom Seed-Zustand der lokalen SQLite-DB.
 */

const sourceView: EvidenceSourceView = {
  citation: kerksick2017Source.citation,
  doi: kerksick2017Source.doi,
  pmid: kerksick2017Source.pmid ?? null,
  pmcid: kerksick2017Source.pmcid ?? null,
  accessedText: kerksick2017Source.accessedText,
};

const realClaims: EvidenceClaimView[] = kerksick2017Claims.map((c) => ({
  claimId: c.claimId,
  claimType: c.claimType,
  topic: c.topic,
  statement: c.statement,
  population: c.population ?? null,
  trainingContext: c.trainingContext ?? null,
  trainingType: c.trainingType ?? null,
  intensityOrDuration: c.intensityOrDuration ?? null,
  nutritionContext: c.nutritionContext ?? null,
  timingContext: c.timingContext ?? null,
  direction: c.direction,
  evidenceStrength: c.evidenceStrength,
  limitations: c.limitations,
  justification: c.justification,
  status: c.status,
  source: sourceView,
}));

describe("Integration: TrainingSession -> Context Mapping -> Evidence Engine", () => {
  it("findet für einen Strength-Trainingskontext die passenden Resistance-Claims aus der echten Library", () => {
    expect(mapSportType("STRENGTH")).toBe("resistance");
    const context = mapTrainingSessionToEvidenceContext({ sportType: "STRENGTH", durationMin: 45, intensity: 3 });
    const { relevant } = retrieveEvidence(context, realClaims);
    const ids = relevant.map((r) => r.claim.claimId);

    expect(ids).toContain("KERK17_CHO_DURING_RESISTANCE");
    expect(ids).toContain("KERK17_PROTEIN_TIMING_ACUTE_VS_LONGTERM");
    expect(ids).toContain("KERK17_ANABOLIC_WINDOW_NOT_SUPPORTED");
    expect(ids).toContain("KERK17_PROTEIN_DOSE_PATTERN_MPS");
    expect(ids).toContain("KERK17_PRESLEEP_CASEIN");

    expect(ids).not.toContain("KERK17_CHO_PRE_ENDURANCE");
    expect(ids).not.toContain("KERK17_CHO_PRE_TIMING_PROXIMITY");
    expect(ids).not.toContain("KERK17_CHO_DURING_DURATION_DEPENDENT");
    expect(ids).not.toContain("KERK17_CHO_POST_RAPID_REFEED");
    expect(ids).not.toContain("KERK17_CHOPROTEIN_GLYCOGEN_CONDITIONAL");
  });

  it("findet für einen Endurance-Trainingskontext die passenden Ausdauer-Claims, keine Resistance-only-Claims", () => {
    const context = mapTrainingSessionToEvidenceContext({ sportType: "ENDURANCE", durationMin: 100, intensity: 4 });
    const { relevant } = retrieveEvidence(context, realClaims);
    const ids = relevant.map((r) => r.claim.claimId);

    expect(ids).toContain("KERK17_CHO_PRE_ENDURANCE");
    expect(ids).toContain("KERK17_CHO_DURING_DURATION_DEPENDENT");

    expect(ids).not.toContain("KERK17_ANABOLIC_WINDOW_NOT_SUPPORTED");
    expect(ids).not.toContain("KERK17_PROTEIN_DOSE_PATTERN_MPS");
    expect(ids).not.toContain("KERK17_PRESLEEP_CASEIN");
  });

  it("erzeugt für eine mehrdeutige Sportart (MIXED) keinen trainingType-Filter und damit keine falschen Treffer", () => {
    const context = mapTrainingSessionToEvidenceContext({ sportType: "MIXED", durationMin: 60, intensity: 3 });
    expect(context).not.toHaveProperty("trainingType");

    const { relevant } = retrieveEvidence(context, realClaims);
    // Ohne trainingType (und ohne jedes andere von der Engine ausgewertete
    // Feld) bleibt kein angefragtes Kontextfeld übrig - die Evidence Engine
    // v1 gibt dann bewusst nichts zurück statt zu raten.
    expect(relevant).toHaveLength(0);
  });

  it("Determinismus: identischer gemappter Kontext liefert exakt dasselbe Retrieval-Ergebnis", () => {
    const context = mapTrainingSessionToEvidenceContext({ sportType: "STRENGTH", durationMin: 45, intensity: 3 });
    const first = retrieveEvidence(context, realClaims);
    const second = retrieveEvidence(context, realClaims);
    expect(second).toEqual(first);
  });
});
