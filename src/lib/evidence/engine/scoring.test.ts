import { describe, expect, it } from "vitest";
import type { EvidenceContext } from "../../validation/evidence";
import type { EvidenceClaimView } from "../evidenceClaimView";
import { evaluateClaim } from "./scoring";

function claim(overrides: Partial<EvidenceClaimView> = {}): EvidenceClaimView {
  return {
    claimId: "TEST_CLAIM",
    claimType: "EVIDENCE_FINDING",
    topic: "pre_exercise_carbohydrate",
    statement: "Test statement.",
    population: "Ausdauersportler; überwiegend männlich",
    trainingContext: "Ausdauerbelastung vor Training",
    trainingType: "endurance",
    intensityOrDuration: "≥70% VO2max, >90 min",
    nutritionContext: "1–4 g/kg CHO, mehrere Stunden vorher",
    timingContext: "pre-exercise",
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

describe("evaluateClaim: Status-Gate", () => {
  it("schließt PENDING_FULL_TEXT aus, unabhängig vom Kontext-Match", () => {
    const c = claim({ status: "PENDING_FULL_TEXT" });
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const result = evaluateClaim(context, c);
    expect(result.relevant).toBe(false);
    expect(result.excludedBecause).toMatch(/PENDING_FULL_TEXT/);
  });

  it("schließt REJECTED aus, unabhängig vom Kontext-Match", () => {
    const c = claim({ status: "REJECTED" });
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "endurance" };
    const result = evaluateClaim(context, c);
    expect(result.relevant).toBe(false);
    expect(result.excludedBecause).toMatch(/REJECTED/);
  });

  it("lässt VERIFIED bei passendem Kontext zu", () => {
    const c = claim({ status: "VERIFIED" });
    const result = evaluateClaim({ trainingType: "endurance" }, c);
    expect(result.relevant).toBe(true);
  });
});

describe("evaluateClaim: leerer Kontext", () => {
  it("liefert für einen komplett leeren Kontext kein Ergebnis (kein angefragtes Feld)", () => {
    const result = evaluateClaim({}, claim());
    expect(result.relevant).toBe(false);
    expect(result.excludedBecause).toMatch(/Kein angefragtes Kontextfeld/);
  });
});

describe("evaluateClaim: Kontextkonflikt", () => {
  it("schließt bei widersprüchlichem trainingType aus, auch wenn topic passt", () => {
    const c = claim({ topic: "pre_exercise_carbohydrate", trainingType: "endurance" });
    const context: EvidenceContext = { topic: "pre_exercise_carbohydrate", trainingType: "resistance" };
    const result = evaluateClaim(context, c);
    expect(result.relevant).toBe(false);
    expect(result.excludedBecause).toMatch(/training type/);
  });

  it("berechnet für ausgeschlossene Claims keinen Score (0) und keine matchReasons", () => {
    const c = claim({ trainingType: "endurance" });
    const result = evaluateClaim({ trainingType: "resistance" }, c);
    expect(result.relevanceScore).toBe(0);
    expect(result.matchReasons).toEqual([]);
  });
});

describe("evaluateClaim: general claim (Claim schränkt Feld nicht ein)", () => {
  it("wertet einen Claim ohne trainingType als potenziell relevant für jeden Trainingstyp", () => {
    const c = claim({ topic: "daily_protein_intake", trainingType: null, trainingContext: null, intensityOrDuration: null, nutritionContext: "1,4–2,0 g/kg/Tag", timingContext: null, population: null });
    const result = evaluateClaim({ trainingType: "resistance" }, c);
    expect(result.relevant).toBe(true);
    expect(result.matchReasons.some((r) => r.includes("training type") && r.includes("allgemein"))).toBe(true);
  });
});

describe("evaluateClaim: exact vs. partial vs. general Scoring", () => {
  it("bewertet einen exakten topic-Treffer höher als einen general-Treffer auf demselben Feld", () => {
    const exactTopic = claim({ topic: "pre_exercise_carbohydrate" });
    const generalTopicClaim = claim({ topic: "some_other_topic" });

    const exactResult = evaluateClaim({ topic: "pre_exercise_carbohydrate" }, exactTopic);
    // topic ist nie "general" (nie null), ein nicht überlappendes topic ist ein Konflikt:
    const conflictResult = evaluateClaim({ topic: "pre_exercise_carbohydrate" }, generalTopicClaim);

    expect(exactResult.relevant).toBe(true);
    expect(conflictResult.relevant).toBe(false);
  });

  it("bewertet einen partial match niedriger als einen exact match auf demselben Feld", () => {
    const exact = claim({ trainingType: "resistance" });
    const partial = claim({ trainingType: "resistance training programs" });

    const exactResult = evaluateClaim({ trainingType: "resistance" }, exact);
    const partialResult = evaluateClaim({ trainingType: "resistance" }, partial);

    expect(exactResult.relevanceScore).toBeGreaterThan(partialResult.relevanceScore);
  });
});

describe("evaluateClaim: direction ist nur ein Bonus, nie ein Ausschlussgrund", () => {
  it("schließt einen Claim mit abweichender direction NICHT aus", () => {
    const c = claim({ topic: "anabolic_window", trainingType: "resistance", direction: "NO_EFFECT" });
    const result = evaluateClaim({ topic: "anabolic_window", trainingType: "resistance", direction: "INCREASE" }, c);
    expect(result.relevant).toBe(true);
  });

  it("vergibt bei übereinstimmender direction einen zusätzlichen Punkt", () => {
    const c = claim({ trainingType: "resistance", direction: "INCREASE" });
    const withMatchingDirection = evaluateClaim({ trainingType: "resistance", direction: "INCREASE" }, c);
    const withoutDirection = evaluateClaim({ trainingType: "resistance" }, c);
    expect(withMatchingDirection.relevanceScore).toBe(withoutDirection.relevanceScore + 1);
  });
});

describe("evaluateClaim: Evidence Strength ist ein kleiner Zusatzfaktor, keine Relevanzgrundlage", () => {
  it("ein LIMITED-Claim mit durchgehend exaktem Kontext-Match kann höher scoren als ein HIGH-Claim ohne jede Kontext-Einschränkung", () => {
    // Bewusst OHNE `topic` im Kontext: ein spezifischer und ein allgemeiner
    // Claim haben in der Praxis meist unterschiedliche topic-Werte - würde
    // der Kontext topic mitliefern, schlösse das den allgemeinen Claim
    // (nicht überlappendes topic = CONFLICT) komplett aus, statt ihn nur
    // niedriger zu bewerten. Hier geht es ausschließlich um den Vergleich
    // "exakter Match auf 6 Feldern" vs. "kein Match, nur general + HIGH".
    const context: EvidenceContext = {
      population: "Ausdauersportler; überwiegend männlich",
      trainingContext: "Ausdauerbelastung vor Training",
      trainingType: "endurance",
      intensityOrDuration: "≥70% VO2max, >90 min",
      nutritionContext: "1–4 g/kg CHO, mehrere Stunden vorher",
      timingContext: "pre-exercise",
    };

    // Alle 6 Felder exakt identisch zum Kontext (siehe claim()-Defaults oben) -> 6x exactPoints.
    const strongContextMatchButLimited = claim({ evidenceStrength: "LIMITED" });
    // Kein einziges der 6 Felder eingeschränkt -> 6x generalPoints + HIGH-Bonus.
    const weakContextMatchButHigh = claim({
      population: null,
      trainingContext: null,
      trainingType: null,
      intensityOrDuration: null,
      nutritionContext: null,
      timingContext: null,
      evidenceStrength: "HIGH",
    });

    const strongResult = evaluateClaim(context, strongContextMatchButLimited);
    const weakResult = evaluateClaim(context, weakContextMatchButHigh);

    // 5 exakte 2-Punkte-Felder + 1 exaktes 1-Punkte-Feld (population) = 11, + LIMITED(0) = 11
    expect(strongResult.relevanceScore).toBe(11);
    // 5 general 1-Punkte-Felder + 1 general population(1) = 6, + HIGH(2) = 8
    expect(weakResult.relevanceScore).toBe(8);
    expect(strongResult.relevanceScore).toBeGreaterThan(weakResult.relevanceScore);
  });

  it("HIGH/MODERATE/LIMITED/UNCERTAIN beeinflussen nur den Score, niemals ob ein Claim relevant ist", () => {
    for (const strength of ["HIGH", "MODERATE", "LIMITED", "UNCERTAIN"] as const) {
      const c = claim({ trainingType: "endurance", evidenceStrength: strength });
      const result = evaluateClaim({ trainingType: "endurance" }, c);
      expect(result.relevant).toBe(true);
    }
  });
});
