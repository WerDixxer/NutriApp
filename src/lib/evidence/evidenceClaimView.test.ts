import { describe, expect, it } from "vitest";
import { toEvidenceClaimView, type EvidenceClaimRow } from "./evidenceClaimView";

function row(overrides: Partial<EvidenceClaimRow> = {}): EvidenceClaimRow {
  return {
    id: "internal-cuid",
    sourceId: "source-cuid",
    claimId: "KERK17_TEST_CLAIM",
    claimType: "EVIDENCE_FINDING",
    topic: "test_topic",
    statement: "Test statement.",
    population: "Testpopulation",
    trainingContext: null,
    trainingType: "endurance",
    intensityOrDuration: null,
    nutritionContext: null,
    timingContext: null,
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: JSON.stringify(["Eine Einschränkung.", "Noch eine."]),
    justification: "Testbegründung.",
    status: "VERIFIED",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    source: {
      id: "source-cuid",
      citation: "Test et al. Test Journal. 2024.",
      doi: "10.1000/test",
      pmid: "12345678",
      pmcid: "PMC1234567",
      accessedText: "FULL_TEXT",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    },
    ...overrides,
  } as EvidenceClaimRow;
}

describe("toEvidenceClaimView", () => {
  it("parst limitations vom JSON-String in ein echtes string[]", () => {
    const view = toEvidenceClaimView(row());
    expect(view.limitations).toEqual(["Eine Einschränkung.", "Noch eine."]);
  });

  it("parst ein leeres limitations-Array korrekt", () => {
    const view = toEvidenceClaimView(row({ limitations: "[]" }));
    expect(view.limitations).toEqual([]);
  });

  it("übernimmt alle Kontextfelder unverändert (inkl. null)", () => {
    const view = toEvidenceClaimView(row());
    expect(view.trainingType).toBe("endurance");
    expect(view.trainingContext).toBeNull();
    expect(view.intensityOrDuration).toBeNull();
  });

  it("bettet die Source vollständig mit doi/pmid/pmcid ein", () => {
    const view = toEvidenceClaimView(row());
    expect(view.source).toEqual({
      citation: "Test et al. Test Journal. 2024.",
      doi: "10.1000/test",
      pmid: "12345678",
      pmcid: "PMC1234567",
      accessedText: "FULL_TEXT",
    });
  });

  it("gibt keine internen Prisma-Felder wie id/sourceId/createdAt/updatedAt weiter", () => {
    const view = toEvidenceClaimView(row());
    expect(view).not.toHaveProperty("id");
    expect(view).not.toHaveProperty("sourceId");
    expect(view).not.toHaveProperty("createdAt");
    expect(view).not.toHaveProperty("updatedAt");
  });
});
