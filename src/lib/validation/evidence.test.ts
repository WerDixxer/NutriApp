import { describe, expect, it } from "vitest";
import {
  evidenceClaimInputSchema,
  evidenceClaimStatusSchema,
  evidenceClaimTypeSchema,
  evidenceContextSchema,
  evidenceSourceInputSchema,
  evidenceStrengthSchema,
} from "./evidence";

const validClaim = {
  claimId: "KERK17_TEST_CLAIM",
  claimType: "EVIDENCE_FINDING",
  topic: "test_topic",
  statement: "Ein Test-Statement.",
  population: "Testpopulation",
  trainingContext: "Testkontext",
  trainingType: "endurance",
  intensityOrDuration: "60 min",
  nutritionContext: "Testernährung",
  timingContext: "post-exercise",
  direction: "INCREASE",
  evidenceStrength: "MODERATE",
  limitations: ["Eine Einschränkung."],
  justification: "Testbegründung.",
  status: "VERIFIED",
};

describe("evidenceClaimTypeSchema", () => {
  it("akzeptiert alle vier zulässigen Werte", () => {
    for (const value of [
      "EVIDENCE_FINDING",
      "AUTHOR_INTERPRETATION",
      "PRACTICAL_RECOMMENDATION",
      "CONTEXTUAL_LIMITATION",
    ]) {
      expect(evidenceClaimTypeSchema.safeParse(value).success).toBe(true);
    }
  });

  it("lehnt einen unbekannten claimType ab", () => {
    expect(evidenceClaimTypeSchema.safeParse("RECOMMENDATION_CONFIDENCE").success).toBe(false);
  });
});

describe("evidenceStrengthSchema", () => {
  it("akzeptiert alle vier zulässigen Werte", () => {
    for (const value of ["HIGH", "MODERATE", "LIMITED", "UNCERTAIN"]) {
      expect(evidenceStrengthSchema.safeParse(value).success).toBe(true);
    }
  });

  it("lehnt einen kombinierten Wert wie 'MODERATE/LIMITED' ab", () => {
    expect(evidenceStrengthSchema.safeParse("MODERATE/LIMITED").success).toBe(false);
  });

  it("lehnt ein Array von zwei Werten ab", () => {
    expect(evidenceStrengthSchema.safeParse(["MODERATE", "LIMITED"]).success).toBe(false);
  });

  it("lehnt Kleinschreibung ab", () => {
    expect(evidenceStrengthSchema.safeParse("moderate").success).toBe(false);
  });
});

describe("evidenceClaimStatusSchema", () => {
  it("akzeptiert 'VERIFIED'", () => {
    expect(evidenceClaimStatusSchema.safeParse("VERIFIED").success).toBe(true);
  });

  it("lehnt 'pending_review' ab (kein gültiger Status)", () => {
    expect(evidenceClaimStatusSchema.safeParse("pending_review").success).toBe(false);
  });

  it("akzeptiert 'PENDING_FULL_TEXT' und 'REJECTED'", () => {
    expect(evidenceClaimStatusSchema.safeParse("PENDING_FULL_TEXT").success).toBe(true);
    expect(evidenceClaimStatusSchema.safeParse("REJECTED").success).toBe(true);
  });
});

describe("evidenceSourceInputSchema", () => {
  it("akzeptiert eine vollständige gültige Source", () => {
    const result = evidenceSourceInputSchema.safeParse({
      citation: "Kerksick CM et al. J Int Soc Sports Nutr. 2017;14:33.",
      doi: "10.1186/s12970-017-0189-4",
      pmid: "28919842",
      pmcid: "PMC5596471",
      accessedText: "FULL_TEXT",
    });
    expect(result.success).toBe(true);
  });

  it("lehnt eine Source ohne doi ab", () => {
    const result = evidenceSourceInputSchema.safeParse({
      citation: "Irgendein Paper.",
      accessedText: "FULL_TEXT",
    });
    expect(result.success).toBe(false);
  });

  it("lehnt einen ungültigen accessedText-Wert ab", () => {
    const result = evidenceSourceInputSchema.safeParse({
      citation: "Irgendein Paper.",
      doi: "10.1234/abc",
      accessedText: "SUMMARY_ONLY",
    });
    expect(result.success).toBe(false);
  });
});

describe("evidenceClaimInputSchema", () => {
  it("akzeptiert einen vollständig gültigen Claim", () => {
    const result = evidenceClaimInputSchema.safeParse(validClaim);
    expect(result.success).toBe(true);
  });

  it("akzeptiert optionale Kontextfelder als null", () => {
    const result = evidenceClaimInputSchema.safeParse({
      ...validClaim,
      population: null,
      trainingType: null,
      intensityOrDuration: null,
    });
    expect(result.success).toBe(true);
  });

  it("lehnt einen ungültigen claimType ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, claimType: "SPECULATION" });
    expect(result.success).toBe(false);
  });

  it("lehnt einen ungültigen evidenceStrength-Wert ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, evidenceStrength: "VERY_HIGH" });
    expect(result.success).toBe(false);
  });

  it("lehnt 'MODERATE/LIMITED' als evidenceStrength ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, evidenceStrength: "MODERATE/LIMITED" });
    expect(result.success).toBe(false);
  });

  it("lehnt ein Array als evidenceStrength ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, evidenceStrength: ["MODERATE", "LIMITED"] });
    expect(result.success).toBe(false);
  });

  it("lehnt einen ungültigen status ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, status: "pending_review" });
    expect(result.success).toBe(false);
  });

  it("lehnt einen claimId ab, der nicht UPPER_SNAKE_CASE ist", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, claimId: "kerk17-test-claim" });
    expect(result.success).toBe(false);
  });

  it("lehnt fehlendes statement ab", () => {
    const withoutStatement: Partial<typeof validClaim> = { ...validClaim };
    delete withoutStatement.statement;
    const result = evidenceClaimInputSchema.safeParse(withoutStatement);
    expect(result.success).toBe(false);
  });

  it("lehnt limitations als Nicht-Array ab", () => {
    const result = evidenceClaimInputSchema.safeParse({ ...validClaim, limitations: "Eine Einschränkung." });
    expect(result.success).toBe(false);
  });

  it("verwendet ein leeres Array als Default für limitations", () => {
    const withoutLimitations: Partial<typeof validClaim> = { ...validClaim };
    delete withoutLimitations.limitations;
    const result = evidenceClaimInputSchema.parse(withoutLimitations);
    expect(result.limitations).toEqual([]);
  });

  it("liest 'recommendationConfidence' nicht als bekanntes Feld ein (kein Teil des Schemas)", () => {
    const result = evidenceClaimInputSchema.parse({ ...validClaim, recommendationConfidence: "HIGH" });
    expect(result).not.toHaveProperty("recommendationConfidence");
  });
});

describe("evidenceContextSchema (Evidence Engine v1)", () => {
  it("akzeptiert einen komplett leeren Kontext (kein Pflichtfeld)", () => {
    expect(evidenceContextSchema.safeParse({}).success).toBe(true);
  });

  it("akzeptiert einen vollständigen Kontext mit allen Feldern", () => {
    const result = evidenceContextSchema.safeParse({
      topic: "pre_exercise_carbohydrate",
      population: "Ausdauersportler",
      trainingContext: "Ausdauerbelastung",
      trainingType: "endurance",
      intensityOrDuration: ">90 min",
      nutritionContext: "1-4 g/kg",
      timingContext: "pre-exercise",
      direction: "INCREASE",
    });
    expect(result.success).toBe(true);
  });

  it("akzeptiert einen Kontext mit nur einem gesetzten Feld", () => {
    expect(evidenceContextSchema.safeParse({ trainingType: "resistance" }).success).toBe(true);
  });

  it("lehnt einen ungültigen direction-Wert ab", () => {
    const result = evidenceContextSchema.safeParse({ direction: "SOMETHING_ELSE" });
    expect(result.success).toBe(false);
  });

  it("lehnt einen leeren String als Feldwert ab (soll stattdessen weggelassen werden)", () => {
    const result = evidenceContextSchema.safeParse({ topic: "" });
    expect(result.success).toBe(false);
  });

  it("entfernt unbekannte Felder wie householdId/userId/profileId (kein Nutzerbezug möglich)", () => {
    const result = evidenceContextSchema.parse({
      trainingType: "resistance",
      householdId: "household-A",
      userId: "user-A",
      profileId: "profile-A",
    });
    expect(result).not.toHaveProperty("householdId");
    expect(result).not.toHaveProperty("userId");
    expect(result).not.toHaveProperty("profileId");
  });

  it("erlaubt KEINE medizinischen Diagnosefelder (nicht Teil des Schemas)", () => {
    const result = evidenceContextSchema.parse({ trainingType: "resistance", diagnosis: "Diabetes Typ 2" });
    expect(result).not.toHaveProperty("diagnosis");
  });

  it("akzeptiert trainingDurationMin als positive ganze Zahl", () => {
    expect(evidenceContextSchema.safeParse({ trainingDurationMin: 90 }).success).toBe(true);
  });

  it("lehnt trainingDurationMin <= 0 ab", () => {
    expect(evidenceContextSchema.safeParse({ trainingDurationMin: 0 }).success).toBe(false);
    expect(evidenceContextSchema.safeParse({ trainingDurationMin: -10 }).success).toBe(false);
  });

  it("lehnt eine nicht-ganzzahlige trainingDurationMin ab", () => {
    expect(evidenceContextSchema.safeParse({ trainingDurationMin: 45.5 }).success).toBe(false);
  });
});
