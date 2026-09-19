import { beforeEach, describe, expect, it, vi } from "vitest";

const evidenceSourceUpsert = vi.fn();
const evidenceSourceFindUnique = vi.fn();
const evidenceClaimUpsert = vi.fn();
const evidenceClaimFindMany = vi.fn();
const evidenceClaimFindUnique = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    evidenceSource: {
      upsert: (...args: unknown[]) => evidenceSourceUpsert(...args),
      findUnique: (...args: unknown[]) => evidenceSourceFindUnique(...args),
    },
    evidenceClaim: {
      upsert: (...args: unknown[]) => evidenceClaimUpsert(...args),
      findMany: (...args: unknown[]) => evidenceClaimFindMany(...args),
      findUnique: (...args: unknown[]) => evidenceClaimFindUnique(...args),
    },
  },
}));

const {
  upsertEvidenceSource,
  upsertEvidenceClaim,
  getEvidenceSourceByDoi,
  listEvidenceClaims,
  getEvidenceClaimByClaimId,
} = await import("./evidenceService");

const sourceInput = {
  citation: "Kerksick CM et al. J Int Soc Sports Nutr. 2017;14:33.",
  doi: "10.1186/s12970-017-0189-4",
  pmid: "28919842",
  pmcid: "PMC5596471",
  accessedText: "FULL_TEXT" as const,
};

const claimInput = {
  claimId: "KERK17_TEST_CLAIM",
  claimType: "EVIDENCE_FINDING" as const,
  topic: "test_topic",
  statement: "Test-Statement.",
  population: "Testpopulation",
  trainingContext: null,
  trainingType: null,
  intensityOrDuration: null,
  nutritionContext: null,
  timingContext: null,
  direction: "INCREASE" as const,
  evidenceStrength: "MODERATE" as const,
  limitations: ["Eine Einschränkung."],
  justification: "Testbegründung.",
  status: "VERIFIED" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("upsertEvidenceSource: Idempotenz über doi", () => {
  it("upsertet über den fachlichen Schlüssel doi, nicht über eine freie id", async () => {
    evidenceSourceUpsert.mockResolvedValueOnce({ id: "src-1" });
    await upsertEvidenceSource(sourceInput);
    expect(evidenceSourceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { doi: sourceInput.doi } }),
    );
  });

  it("übernimmt create UND update mit denselben Feldwerten (wiederholtes Seeden aktualisiert statt zu duplizieren)", async () => {
    evidenceSourceUpsert.mockResolvedValueOnce({ id: "src-1" });
    await upsertEvidenceSource(sourceInput);
    const call = evidenceSourceUpsert.mock.calls[0][0];
    expect(call.create.doi).toBe(sourceInput.doi);
    expect(call.update.citation).toBe(sourceInput.citation);
    expect(call.update.pmid).toBe(sourceInput.pmid);
  });
});

describe("upsertEvidenceClaim: Idempotenz über claimId", () => {
  it("upsertet über den fachlichen Schlüssel claimId, nicht über eine freie id", async () => {
    evidenceClaimUpsert.mockResolvedValueOnce({ id: "claim-1" });
    await upsertEvidenceClaim("src-1", claimInput);
    expect(evidenceClaimUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { claimId: claimInput.claimId } }),
    );
  });

  it("serialisiert limitations als JSON-String (SQLite kennt keine nativen Arrays)", async () => {
    evidenceClaimUpsert.mockResolvedValueOnce({ id: "claim-1" });
    await upsertEvidenceClaim("src-1", claimInput);
    const call = evidenceClaimUpsert.mock.calls[0][0];
    expect(call.create.limitations).toBe(JSON.stringify(claimInput.limitations));
    expect(call.update.limitations).toBe(JSON.stringify(claimInput.limitations));
  });

  it("hängt den Claim an die übergebene sourceId, nie an eine hart codierte", async () => {
    evidenceClaimUpsert.mockResolvedValueOnce({ id: "claim-1" });
    await upsertEvidenceClaim("src-42", claimInput);
    const call = evidenceClaimUpsert.mock.calls[0][0];
    expect(call.create.sourceId).toBe("src-42");
    expect(call.update.sourceId).toBe("src-42");
  });

  it("übergibt null statt undefined für fehlende optionale Kontextfelder", async () => {
    evidenceClaimUpsert.mockResolvedValueOnce({ id: "claim-1" });
    await upsertEvidenceClaim("src-1", claimInput);
    const call = evidenceClaimUpsert.mock.calls[0][0];
    expect(call.create.trainingContext).toBeNull();
    expect(call.create.trainingType).toBeNull();
  });

  it("schreibt niemals ein householdId- oder profileId-Feld (Evidence Library ist bewusst nicht nutzerspezifisch)", async () => {
    evidenceClaimUpsert.mockResolvedValueOnce({ id: "claim-1" });
    await upsertEvidenceClaim("src-1", claimInput);
    const call = evidenceClaimUpsert.mock.calls[0][0];
    expect(call.create).not.toHaveProperty("householdId");
    expect(call.create).not.toHaveProperty("profileId");
    expect(call.update).not.toHaveProperty("householdId");
    expect(call.update).not.toHaveProperty("profileId");
  });
});

describe("Lesefunktionen: keine Household-/User-Scope-Parameter", () => {
  it("getEvidenceSourceByDoi fragt ausschließlich nach doi", async () => {
    evidenceSourceFindUnique.mockResolvedValueOnce(null);
    await getEvidenceSourceByDoi("10.1186/s12970-017-0189-4");
    expect(evidenceSourceFindUnique).toHaveBeenCalledWith({ where: { doi: "10.1186/s12970-017-0189-4" } });
  });

  it("listEvidenceClaims lädt alle Claims inklusive Source, ohne Scope-Filter", async () => {
    evidenceClaimFindMany.mockResolvedValueOnce([]);
    await listEvidenceClaims();
    expect(evidenceClaimFindMany).toHaveBeenCalledWith({
      include: { source: true },
      orderBy: { claimId: "asc" },
    });
  });

  it("getEvidenceClaimByClaimId fragt ausschließlich nach claimId", async () => {
    evidenceClaimFindUnique.mockResolvedValueOnce(null);
    await getEvidenceClaimByClaimId("KERK17_TEST_CLAIM");
    expect(evidenceClaimFindUnique).toHaveBeenCalledWith({
      where: { claimId: "KERK17_TEST_CLAIM" },
      include: { source: true },
    });
  });
});
