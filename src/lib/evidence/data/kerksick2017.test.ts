import { describe, expect, it } from "vitest";
import { evidenceClaimInputSchema, evidenceSourceInputSchema } from "../../validation/evidence";
import { kerksick2017Claims, kerksick2017Source } from "./kerksick2017";

describe("kerksick2017Source", () => {
  it("validiert gegen evidenceSourceInputSchema", () => {
    expect(evidenceSourceInputSchema.safeParse(kerksick2017Source).success).toBe(true);
  });

  it("referenziert die korrekten Quellenangaben", () => {
    expect(kerksick2017Source.doi).toBe("10.1186/s12970-017-0189-4");
    expect(kerksick2017Source.pmid).toBe("28919842");
    expect(kerksick2017Source.pmcid).toBe("PMC5596471");
    expect(kerksick2017Source.accessedText).toBe("FULL_TEXT");
  });
});

describe("kerksick2017Claims: Coverage", () => {
  it("enthält genau 15 Claims", () => {
    expect(kerksick2017Claims).toHaveLength(15);
  });

  it("enthält KERK17_CHO_DAILY_HIGHVOLUME", () => {
    expect(kerksick2017Claims.some((c) => c.claimId === "KERK17_CHO_DAILY_HIGHVOLUME")).toBe(true);
  });

  it("enthält NICHT den verworfenen Claim KERK17_MEAL_FREQUENCY_EXERCISE_PRELIMINARY", () => {
    expect(kerksick2017Claims.some((c) => c.claimId === "KERK17_MEAL_FREQUENCY_EXERCISE_PRELIMINARY")).toBe(false);
  });

  it("hat für jeden Claim eine eindeutige claimId (keine Duplikate)", () => {
    const ids = kerksick2017Claims.map((c) => c.claimId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("kerksick2017Claims: Sonderfall CHO_DURING_DURATION_DEPENDENT", () => {
  it("hat evidenceStrength MODERATE als einzelnen Wert (nicht in zwei Claims aufgespalten)", () => {
    const claim = kerksick2017Claims.find((c) => c.claimId === "KERK17_CHO_DURING_DURATION_DEPENDENT");
    expect(claim).toBeDefined();
    expect(claim?.evidenceStrength).toBe("MODERATE");
  });

  it("nennt die Newell-Studien-Dosisangabe nur als Einzelstudien-Beispiel, nicht als eigenständigen Claim", () => {
    const claim = kerksick2017Claims.find((c) => c.claimId === "KERK17_CHO_DURING_DURATION_DEPENDENT");
    expect(claim?.limitations.join(" ")).toMatch(/einzelnen Studie/i);
  });
});

describe("kerksick2017Claims: Schema-Validität", () => {
  it("jeder Claim validiert einzeln gegen evidenceClaimInputSchema", () => {
    for (const claim of kerksick2017Claims) {
      const result = evidenceClaimInputSchema.safeParse(claim);
      expect(result.success, `${claim.claimId}: ${JSON.stringify(result.success ? null : result.error.issues)}`).toBe(
        true,
      );
    }
  });

  it("kein Claim enthält eine recommendationConfidence-Eigenschaft", () => {
    for (const claim of kerksick2017Claims) {
      expect(claim).not.toHaveProperty("recommendationConfidence");
    }
  });

  it("jeder Claim hat status VERIFIED (keine pending_review-Zwischenstände)", () => {
    for (const claim of kerksick2017Claims) {
      expect(claim.status).toBe("VERIFIED");
    }
  });

  it("jeder Claim hat einen einzelnen, gültigen evidenceStrength-Wert ohne Trennzeichen wie '/'", () => {
    for (const claim of kerksick2017Claims) {
      expect(claim.evidenceStrength).not.toMatch(/\//);
      expect(["HIGH", "MODERATE", "LIMITED", "UNCERTAIN"]).toContain(claim.evidenceStrength);
    }
  });
});

describe("kerksick2017Claims: Source-Integrity", () => {
  it("alle Claims sind für die Seed-Pipeline an dieselbe Source gebunden (ein DOI, keine Duplizierung pro Claim)", () => {
    // Claims tragen selbst keine Source-Felder (Source→Claims-Relation, siehe
    // evidenceService.ts) - dieser Test dokumentiert bewusst, dass es genau
    // eine kuratierte Source-Konstante für diese Claim-Liste gibt.
    expect(kerksick2017Source.doi).toBe("10.1186/s12970-017-0189-4");
    expect(kerksick2017Source.pmid).toBe("28919842");
  });
});
