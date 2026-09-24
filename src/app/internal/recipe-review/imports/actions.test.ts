import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sicherheit der Import-Queue-Actions (Kapitel 21): keine echte Session, keine Datenbank. `auth()`
 * und der Service sind Mocks - geprüft wird, dass ohne Berechtigung KEINE Service-Mutation erreicht
 * wird, dass die Actor-ID aus der Session statt aus dem Formular kommt und dass manipulierte
 * Eingaben abgewiesen werden. `redirect`/`notFound` werfen wie in Next.js.
 */
const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const service = vi.hoisted(() => ({
  loadImportReviewContext: vi.fn(),
  markNeedsChanges: vi.fn(),
  resubmitForReview: vi.fn(),
  rejectCandidate: vi.fn(),
  approveCandidate: vi.fn(),
  assignIngredientFood: vi.fn(),
  publishCandidate: vi.fn(),
  enqueueImportedRecipe: vi.fn(),
}));
vi.mock("@/lib/recipes/importQueueService", () => service);

const actions = await import("./actions");

const REVIEWER_SESSION = { user: { id: "session-user", email: "reviewer@example.com" } };
const context = { catalog: { marker: "catalog" }, existingRecipes: [] };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const mutatingActions = [
  ["markNeedsChangesAction", () => actions.markNeedsChangesAction(form({ candidateId: "c1", note: "x" }))],
  ["resubmitForReviewAction", () => actions.resubmitForReviewAction(form({ candidateId: "c1" }))],
  ["rejectCandidateAction", () => actions.rejectCandidateAction(form({ candidateId: "c1", note: "Grund" }))],
  ["approveCandidateAction", () => actions.approveCandidateAction(form({ candidateId: "c1", acknowledgeDuplicates: "on", note: "ok" }))],
  ["assignIngredientFoodAction", () => actions.assignIngredientFoodAction(form({ candidateId: "c1", ingredientIndex: "1", foodId: "beeren" }))],
  ["publishCandidateAction", () => actions.publishCandidateAction(form({ candidateId: "c1" }))],
  ["enqueueMockFixturesAction", () => actions.enqueueMockFixturesAction()],
] as const;

function expectNoServiceCall() {
  for (const fn of Object.values(service)) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERNAL_REVIEW_EMAILS;
  vi.stubEnv("NODE_ENV", "development");
  service.loadImportReviewContext.mockResolvedValue(context);
  for (const fn of [service.markNeedsChanges, service.resubmitForReview, service.rejectCandidate, service.approveCandidate, service.assignIngredientFood, service.publishCandidate]) {
    fn.mockResolvedValue({ ok: true });
  }
  service.enqueueImportedRecipe.mockResolvedValue({ ok: true, candidateId: "new" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.INTERNAL_REVIEW_EMAILS;
});

describe("Autorisierung jeder mutierenden Action", () => {
  it.each(mutatingActions)("%s: ohne Login -> /login, keine Mutation", async (_name, run) => {
    authMock.mockResolvedValue(null);
    await expect(run()).rejects.toThrow("REDIRECT:/login");
    expectNoServiceCall();
  });

  it.each(mutatingActions)("%s: eingeloggt, aber nicht freigeschaltet -> 404, keine Mutation", async (_name, run) => {
    process.env.INTERNAL_REVIEW_EMAILS = "admin@example.com";
    authMock.mockResolvedValue({ user: { id: "u2", email: "vincenzo@example.com" } });
    await expect(run()).rejects.toThrow("NOT_FOUND");
    expectNoServiceCall();
  });

  it.each(mutatingActions)("%s: in Produktion ohne Allowlist für niemanden -> 404", async (_name, run) => {
    vi.stubEnv("NODE_ENV", "production");
    authMock.mockResolvedValue(REVIEWER_SESSION);
    await expect(run()).rejects.toThrow("NOT_FOUND");
    expectNoServiceCall();
  });
});

describe("Eingaben und Actor", () => {
  beforeEach(() => authMock.mockResolvedValue(REVIEWER_SESSION));

  it("nimmt die Actor-ID aus der Session, ein eingeschleustes Formularfeld wird ignoriert", async () => {
    await expect(
      actions.publishCandidateAction(form({ candidateId: "c1", userId: "attacker", actorUserId: "attacker" })),
    ).rejects.toThrow("REDIRECT:/internal/recipe-review/imports/c1?done=published");
    expect(service.publishCandidate).toHaveBeenCalledWith("c1", { userId: "session-user" }, context);
  });

  it.each([["", "leere ID"], ["x".repeat(65), "überlange ID"]])("weist eine manipulierte Kandidaten-ID ab (%s)", async (candidateId) => {
    await expect(actions.rejectCandidateAction(form({ candidateId, note: "Grund" }))).rejects.toThrow(
      "REDIRECT:/internal/recipe-review?importError=INVALID_INPUT",
    );
    expect(service.rejectCandidate).not.toHaveBeenCalled();
  });

  it("eine unbekannte ID landet mit Fehlermeldung in der Queue, nicht auf einer Erfolgsseite", async () => {
    service.markNeedsChanges.mockResolvedValue({ ok: false, error: "NOT_FOUND" });
    await expect(actions.markNeedsChangesAction(form({ candidateId: "gibt-es-nicht" }))).rejects.toThrow(
      "REDIRECT:/internal/recipe-review?importError=NOT_FOUND",
    );
  });

  it("Sonderzeichen in der ID werden für die Weiterleitung kodiert", async () => {
    service.markNeedsChanges.mockResolvedValue({ ok: false, error: "INVALID_TRANSITION" });
    await expect(actions.markNeedsChangesAction(form({ candidateId: "a/../b?x=1" }))).rejects.toThrow(
      `REDIRECT:/internal/recipe-review/imports/${encodeURIComponent("a/../b?x=1")}?error=INVALID_TRANSITION`,
    );
  });

  it("ein abgelehnter Übergang führt zur Fehlermeldung, nie zu ?done=", async () => {
    service.publishCandidate.mockResolvedValue({ ok: false, error: "ALREADY_PUBLISHED", recipeId: "r1" });
    await expect(actions.publishCandidateAction(form({ candidateId: "c1" }))).rejects.toThrow(
      "REDIRECT:/internal/recipe-review/imports/c1?error=ALREADY_PUBLISHED",
    );
  });

  it("Approve liest die Duplikat-Bestätigung aus der Checkbox und lädt den Katalog serverseitig", async () => {
    await expect(actions.approveCandidateAction(form({ candidateId: "c1", note: "bewusst eigenständig" }))).rejects.toThrow("done=approved");
    expect(service.approveCandidate).toHaveBeenCalledWith("c1", { userId: "session-user" }, context, {
      acknowledgeDuplicates: false,
      note: "bewusst eigenständig",
    });
  });

  it.each([["abc"], ["-1"], ["1.5"]])("Food-Zuordnung mit ungültigem Zutatenindex %s wird abgewiesen", async (ingredientIndex) => {
    await expect(actions.assignIngredientFoodAction(form({ candidateId: "c1", ingredientIndex, foodId: "beeren" }))).rejects.toThrow(
      "REDIRECT:/internal/recipe-review/imports/c1?error=INVALID_INPUT",
    );
    expect(service.assignIngredientFood).not.toHaveBeenCalled();
  });

  it("zu lange Notizen werden abgewiesen, bevor der Service etwas schreibt", async () => {
    await expect(actions.rejectCandidateAction(form({ candidateId: "c1", note: "x".repeat(2001) }))).rejects.toThrow("error=INVALID_INPUT");
    expect(service.rejectCandidate).not.toHaveBeenCalled();
  });

  it("der Fixture-Import meldet angelegte und übersprungene Kandidaten", async () => {
    service.enqueueImportedRecipe
      .mockResolvedValueOnce({ ok: true, candidateId: "a" })
      .mockResolvedValue({ ok: false, error: "DUPLICATE_SOURCE", existingCandidateId: "x" });
    await expect(actions.enqueueMockFixturesAction()).rejects.toThrow("REDIRECT:/internal/recipe-review?imported=1&skipped=4");
    expect(service.enqueueImportedRecipe).toHaveBeenCalledTimes(5);
    expect(service.enqueueImportedRecipe).toHaveBeenCalledWith(expect.objectContaining({ name: "Protein Pancakes" }), context.catalog, { userId: "session-user" });
  });
});
