import { describe, expect, it } from "vitest";
import type { EvidenceContext } from "../../validation/evidence";
import type { EvidenceClaimView } from "../evidenceClaimView";
import { retrieveEvidence } from "./retrieveEvidence";

function claim(overrides: Partial<EvidenceClaimView> = {}): EvidenceClaimView {
  return {
    claimId: "TEST_CLAIM",
    claimType: "EVIDENCE_FINDING",
    topic: "test_topic",
    statement: "Test statement.",
    population: null,
    trainingContext: null,
    trainingType: null,
    intensityOrDuration: null,
    nutritionContext: null,
    timingContext: null,
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: [],
    justification: "Test justification.",
    status: "VERIFIED",
    source: {
      citation: "Test et al. Test Journal. 2024.",
      doi: "10.1000/test",
      pmid: "12345678",
      pmcid: "PMC1234567",
      accessedText: "FULL_TEXT",
    },
    ...overrides,
  };
}

// Realistische, an den echten Kerksick-Claims orientierte Fixtures.
const enduranceClaim = claim({
  claimId: "FIXTURE_CHO_PRE_ENDURANCE",
  topic: "pre_exercise_carbohydrate",
  population: "Ausdauersportler; überwiegend männlich",
  trainingContext: "Ausdauerbelastung vor Training/Wettkampf",
  trainingType: "endurance",
  intensityOrDuration: "≥70% VO2max, >90 min",
  nutritionContext: "1–4 g/kg CHO, mehrere Stunden vorher",
  timingContext: "pre-exercise",
  evidenceStrength: "MODERATE",
});

const generalProteinClaim = claim({
  claimId: "FIXTURE_PROTEIN_DAILY_TOTAL_PRIORITY",
  topic: "daily_protein_intake",
  population: null,
  trainingContext: null,
  trainingType: null,
  intensityOrDuration: null,
  nutritionContext: "1,4–2,0 g/kg/Tag",
  timingContext: null,
  evidenceStrength: "MODERATE",
});

const resistanceClaim = claim({
  claimId: "FIXTURE_PROTEIN_DOSE_PATTERN",
  topic: "protein_dose_distribution",
  trainingContext: "post-resistance-exercise, 12h-Messfenster",
  trainingType: "resistance",
  intensityOrDuration: "12h-Beobachtungsfenster",
  nutritionContext: "20g Protein alle 3h",
  timingContext: "post-exercise",
  evidenceStrength: "LIMITED",
});

const pendingClaim = claim({
  claimId: "FIXTURE_PENDING",
  topic: "pre_exercise_carbohydrate",
  trainingType: "endurance",
  status: "PENDING_FULL_TEXT",
});

const rejectedClaim = claim({
  claimId: "FIXTURE_REJECTED",
  topic: "pre_exercise_carbohydrate",
  trainingType: "endurance",
  status: "REJECTED",
});

const allFixtures = [enduranceClaim, generalProteinClaim, resistanceClaim, pendingClaim, rejectedClaim];

describe("retrieveEvidence: exakter Match", () => {
  it("findet einen Claim über exakten topic- und trainingType-Match", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant } = retrieveEvidence(context, allFixtures);
    expect(relevant.map((r) => r.claim.claimId)).toContain("FIXTURE_CHO_PRE_ENDURANCE");
  });
});

describe("retrieveEvidence: teilweiser Match", () => {
  it("findet einen Claim über einen Teilstring-Match auf trainingContext", () => {
    const context: EvidenceContext = { trainingContext: "resistance-exercise" };
    const { relevant } = retrieveEvidence(context, [resistanceClaim]);
    expect(relevant).toHaveLength(1);
    expect(relevant[0].matchReasons.some((r) => r.startsWith("partial"))).toBe(true);
  });
});

describe("retrieveEvidence: allgemeiner Claim", () => {
  it("gibt einen Claim ohne trainingType-Einschränkung auch für einen spezifischen Trainingstyp zurück", () => {
    const context: EvidenceContext = { trainingType: "resistance" };
    const { relevant } = retrieveEvidence(context, [generalProteinClaim, enduranceClaim]);
    const ids = relevant.map((r) => r.claim.claimId);
    expect(ids).toContain("FIXTURE_PROTEIN_DAILY_TOTAL_PRIORITY");
    expect(ids).not.toContain("FIXTURE_CHO_PRE_ENDURANCE");
  });
});

describe("retrieveEvidence: Kontextkonflikt", () => {
  it("schließt einen Ausdauer->90min-Claim für einen Krafttraining-45min-Kontext aus", () => {
    const context: EvidenceContext = { trainingType: "resistance", intensityOrDuration: "45 min" };
    const { relevant, excluded } = retrieveEvidence(context, [enduranceClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].excludedBecause).toMatch(/training type/);
  });
});

describe("retrieveEvidence: fehlender Kontext", () => {
  it("liefert für einen komplett leeren Kontext keine relevanten Claims", () => {
    const { relevant } = retrieveEvidence({}, allFixtures);
    expect(relevant).toHaveLength(0);
  });

  it("landet ein VERIFIED-Claim bei leerem Kontext in excluded, nicht stillschweigend nirgendwo", () => {
    const { excluded } = retrieveEvidence({}, [enduranceClaim]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].excludedBecause).toMatch(/Kein angefragtes Kontextfeld/);
  });
});

describe("retrieveEvidence: falscher Trainingstyp", () => {
  it("schließt einen resistance-Claim für einen endurance-Kontext aus", () => {
    const context: EvidenceContext = { topic: "protein_dose_distribution", trainingType: "endurance" };
    const { relevant, excluded } = retrieveEvidence(context, [resistanceClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/training type/);
  });
});

describe("retrieveEvidence: falsche Trainingsdauer", () => {
  it("schließt einen >90min-Claim für einen 45min-Kontext aus, auch bei passendem trainingType", () => {
    const context: EvidenceContext = { trainingType: "endurance", intensityOrDuration: "45 min" };
    const { relevant, excluded } = retrieveEvidence(context, [enduranceClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/intensity\/duration/);
  });
});

describe("retrieveEvidence: falsches Timing", () => {
  it("schließt einen pre-exercise-Claim für einen post-exercise-Kontext aus", () => {
    const context: EvidenceContext = { timingContext: "post-exercise" };
    const { relevant, excluded } = retrieveEvidence(context, [enduranceClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/timing context/);
  });
});

describe("retrieveEvidence: falscher Nutrition Context", () => {
  it("schließt einen Claim mit widersprüchlichem nutritionContext aus", () => {
    const context: EvidenceContext = { nutritionContext: "0.3 g/kg/h Fett" };
    const { relevant, excluded } = retrieveEvidence(context, [resistanceClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/nutrition context/);
  });
});

describe("retrieveEvidence: Status-Filterung", () => {
  it("gibt VERIFIED-Claims zurück", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant } = retrieveEvidence(context, [enduranceClaim]);
    expect(relevant).toHaveLength(1);
  });

  it("schließt PENDING_FULL_TEXT bei sonst perfektem Match aus", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant, excluded } = retrieveEvidence(context, [pendingClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/PENDING_FULL_TEXT/);
  });

  it("schließt REJECTED bei sonst perfektem Match aus", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant, excluded } = retrieveEvidence(context, [rejectedClaim]);
    expect(relevant).toHaveLength(0);
    expect(excluded[0].excludedBecause).toMatch(/REJECTED/);
  });

  it("gibt in einer gemischten Liste NUR die VERIFIED-Treffer zurück", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant } = retrieveEvidence(context, allFixtures);
    expect(relevant.every((r) => r.claim.status === "VERIFIED")).toBe(true);
  });
});

describe("retrieveEvidence: Evidence Strength ≠ Recommendation Confidence", () => {
  it("relevanceScore ist niemals identisch mit dem evidenceStrength-String (unterschiedliche Domänen)", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant } = retrieveEvidence(context, [enduranceClaim]);
    expect(typeof relevant[0].relevanceScore).toBe("number");
    expect(relevant[0].claim.evidenceStrength).toBe("MODERATE");
    // Score ist eine reine Zahl, evidenceStrength bleibt am Claim selbst -
    // die Engine erzeugt keine dritte, vermischte Größe.
    expect(relevant[0]).not.toHaveProperty("recommendationConfidence");
    expect(relevant[0]).not.toHaveProperty("evidenceStrength");
  });
});

describe("retrieveEvidence: Traceability", () => {
  it("jeder zurückgegebene Claim trägt die vollständige Source mit doi/pmid/pmcid", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const { relevant } = retrieveEvidence(context, [enduranceClaim]);
    expect(relevant[0].source.doi).toBe("10.1000/test");
    expect(relevant[0].source.pmid).toBe("12345678");
    expect(relevant[0].source.pmcid).toBe("PMC1234567");
    expect(relevant[0].claim.source).toBe(relevant[0].source);
  });
});

describe("retrieveEvidence: Determinismus", () => {
  it("liefert bei identischem Input exakt dasselbe Ergebnis", () => {
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const first = retrieveEvidence(context, allFixtures);
    const second = retrieveEvidence(context, allFixtures);
    expect(second).toEqual(first);
  });

  it("liefert bei anderer Eingabe-Reihenfolge der Claims dieselbe sortierte Ausgabe", () => {
    const context: EvidenceContext = { trainingType: "resistance" };
    const inOrder = retrieveEvidence(context, [generalProteinClaim, resistanceClaim]);
    const reversed = retrieveEvidence(context, [resistanceClaim, generalProteinClaim]);
    expect(reversed.relevant.map((r) => r.claim.claimId)).toEqual(inOrder.relevant.map((r) => r.claim.claimId));
  });

  it("sortiert relevante Claims nach relevanceScore absteigend", () => {
    const context: EvidenceContext = { trainingType: "resistance" };
    const { relevant } = retrieveEvidence(context, [generalProteinClaim, resistanceClaim]);
    for (let i = 1; i < relevant.length; i++) {
      expect(relevant[i - 1].relevanceScore).toBeGreaterThanOrEqual(relevant[i].relevanceScore);
    }
  });
});

describe("retrieveEvidence: keine Isolation-Parameter", () => {
  it("EvidenceContext akzeptiert keinen householdId/userId/profileId (Compile-Zeit-Garantie, hier zur Dokumentation)", () => {
    const context: EvidenceContext = { trainingType: "resistance" };
    expect(context).not.toHaveProperty("householdId");
    expect(context).not.toHaveProperty("userId");
    expect(context).not.toHaveProperty("profileId");
  });
});
