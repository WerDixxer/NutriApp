import { beforeEach, describe, expect, it, vi } from "vitest";

const listEvidenceClaims = vi.fn();

vi.mock("../evidenceService", () => ({
  listEvidenceClaims: (...args: unknown[]) => listEvidenceClaims(...args),
}));

const { retrieveEvidenceForContext } = await import("./evidenceEngineService");

function claimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "internal-cuid",
    sourceId: "source-cuid",
    claimId: "KERK17_TEST_CLAIM",
    claimType: "EVIDENCE_FINDING",
    topic: "pre_exercise_carbohydrate",
    statement: "Test statement.",
    population: null,
    trainingContext: null,
    trainingType: "endurance",
    intensityOrDuration: null,
    nutritionContext: null,
    timingContext: null,
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: "[]",
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("retrieveEvidenceForContext", () => {
  it("lädt Claims über die bestehende evidenceService.listEvidenceClaims() (keine eigene DB-Query)", async () => {
    listEvidenceClaims.mockResolvedValueOnce([claimRow()]);
    await retrieveEvidenceForContext({ topic: "pre_exercise_carbohydrate", trainingType: "endurance" });
    expect(listEvidenceClaims).toHaveBeenCalledTimes(1);
    expect(listEvidenceClaims).toHaveBeenCalledWith();
  });

  it("gibt einen passenden, aus der DB geladenen Claim als relevant zurück", async () => {
    listEvidenceClaims.mockResolvedValueOnce([claimRow()]);
    const result = await retrieveEvidenceForContext({ topic: "pre_exercise_carbohydrate", trainingType: "endurance" });
    expect(result.relevant).toHaveLength(1);
    expect(result.relevant[0].claim.claimId).toBe("KERK17_TEST_CLAIM");
    expect(result.relevant[0].source.doi).toBe("10.1000/test");
  });

  it("validiert den rohen Kontext per Zod und lehnt einen ungültigen direction-Wert ab, bevor die DB abgefragt wird", async () => {
    // Kein mockResolvedValueOnce hier: die Zod-Validierung schlägt VOR dem
    // listEvidenceClaims()-Aufruf fehl, ein hier gesetzter Rückgabewert
    // bliebe unkonsumiert in der Mock-Queue und würde den nächsten Test
    // verfälschen (vi.clearAllMocks() leert nur calls/results, nicht die
    // mockResolvedValueOnce-Queue).
    await expect(retrieveEvidenceForContext({ direction: "SOMETHING_ELSE" })).rejects.toThrow();
    expect(listEvidenceClaims).not.toHaveBeenCalled();
  });

  it("ignoriert householdId/userId/profileId im rohen Kontext stillschweigend (kein Isolation-Leck möglich)", async () => {
    listEvidenceClaims.mockResolvedValueOnce([claimRow()]);
    const result = await retrieveEvidenceForContext({
      topic: "pre_exercise_carbohydrate",
      trainingType: "endurance",
      householdId: "household-A",
      userId: "user-A",
    });
    expect(result.relevant).toHaveLength(1);
    expect(listEvidenceClaims).toHaveBeenCalledWith();
  });

  it("gibt bei leerem Kontext keine relevanten Claims zurück, auch wenn Claims vorhanden sind", async () => {
    listEvidenceClaims.mockResolvedValueOnce([claimRow()]);
    const result = await retrieveEvidenceForContext({});
    expect(result.relevant).toHaveLength(0);
  });
});
