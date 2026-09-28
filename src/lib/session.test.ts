import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireInternalReviewAccess (Kapitel 19): keine echte Session, keine echte Datenbank. `redirect`
 * und `notFound` werfen im echten Next.js eine Steuerfluss-Exception; hier durch unterscheidbare
 * Fehler ersetzt, damit Tests das Verhalten ohne Next-Runtime prüfen können.
 */
const authMock = vi.fn();
vi.mock("./auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }));
vi.mock("./db", () => ({ prisma: {} }));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const notFoundMock = vi.fn(() => {
  throw new Error("NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  redirect: (...args: Parameters<typeof redirectMock>) => redirectMock(...args),
  notFound: (...args: Parameters<typeof notFoundMock>) => notFoundMock(...args),
}));

const { requireInternalReviewAccess } = await import("./session");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INTERNAL_REVIEW_EMAILS;
});

describe("requireInternalReviewAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.INTERNAL_REVIEW_EMAILS;
  });

  it("leitet nicht eingeloggte Nutzer zu /login um, statt eine Zugriffsentscheidung zu treffen", async () => {
    authMock.mockResolvedValueOnce(null);
    await expect(requireInternalReviewAccess()).rejects.toThrow("REDIRECT:/login");
  });

  it("lokal mit der eigenen E-Mail in der Allowlist ist der Zugriff möglich", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.INTERNAL_REVIEW_EMAILS = "dev@example.com";
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "dev@example.com" } });
    await expect(requireInternalReviewAccess()).resolves.toEqual({ userId: "u1", email: "dev@example.com" });
  });

  it.each(["development", "test"])(
    "ist ohne Allowlist auch außerhalb von Produktion (%s) geschlossen - z.B. ein per Tunnel geteilter Dev-Server (F-07)",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);
      authMock.mockResolvedValueOnce({ user: { id: "u1", email: "irgendwer@example.com" } });
      await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
    },
  );

  it("ist in Produktion ohne gesetzte Allowlist für niemanden zugänglich (sicher geschlossen)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "irgendwer@example.com" } });
    await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
  });

  it("in Produktion hat eine gelistete E-Mail Zugriff, eine andere nicht", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.INTERNAL_REVIEW_EMAILS = "admin@example.com";
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "admin@example.com" } });
    await expect(requireInternalReviewAccess()).resolves.toEqual({ userId: "u1", email: "admin@example.com" });

    authMock.mockResolvedValueOnce({ user: { id: "u2", email: "other@example.com" } });
    await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
  });

  it("eine Allowlist nur aus ungültigen Einträgen öffnet nichts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.INTERNAL_REVIEW_EMAILS = " , admin, *";
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "admin" } });
    await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
  });

  it("mit gesetzter Allowlist hat nur eine gelistete E-Mail Zugriff, unabhängig von Groß-/Kleinschreibung", async () => {
    process.env.INTERNAL_REVIEW_EMAILS = "Admin@Example.com, other@example.com";
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "admin@example.com" } });
    await expect(requireInternalReviewAccess()).resolves.toEqual({ userId: "u1", email: "admin@example.com" });
  });

  it("mit gesetzter Allowlist wird eine nicht gelistete E-Mail abgewiesen, selbst außerhalb von Produktion", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.INTERNAL_REVIEW_EMAILS = "admin@example.com";
    // Nur ein Textwert im Mock, keine echte Datenbankabfrage: belegt, dass ein reales Profil ohne
    // ausdrückliche Freigabe ebenfalls keinen Zugriff bekäme.
    authMock.mockResolvedValueOnce({ user: { id: "u2", email: "vincenzo@example.com" } });
    await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
  });

  it("ohne E-Mail auf der Session wird bei gesetzter Allowlist abgewiesen", async () => {
    process.env.INTERNAL_REVIEW_EMAILS = "admin@example.com";
    authMock.mockResolvedValueOnce({ user: { id: "u3", email: null } });
    await expect(requireInternalReviewAccess()).rejects.toThrow("NOT_FOUND");
  });
});
