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

  it("erlaubt außerhalb von Produktion ohne gesetzte Allowlist jedem eingeloggten Nutzer den Zugriff (lokale Nutzbarkeit ohne Konfiguration)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "irgendwer@example.com" } });
    await expect(requireInternalReviewAccess()).resolves.toEqual({ userId: "u1", email: "irgendwer@example.com" });
  });

  it("ist in Produktion ohne gesetzte Allowlist für niemanden zugänglich (sicher geschlossen)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    authMock.mockResolvedValueOnce({ user: { id: "u1", email: "irgendwer@example.com" } });
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
