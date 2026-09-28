import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkServerConfigAtStartup,
  findConfigProblems,
  isSupportedLlmModel,
  mockRecipeSourcesAllowed,
  parseInternalReviewEmails,
  ServerConfigError,
  type ServerEnv,
} from "./env";

/**
 * Zentrale Konfigurationsprüfung (F-21). Geprüft wird die reine Funktion über explizite
 * Env-Objekte - `process.env` des Testlaufs bleibt unberührt.
 */
const SECRET = "s3cr3t-auth-value-that-is-long-enough-000";
const API_KEY = "sk-ant-test-key-do-not-leak";
const DB_URL = "postgresql://vyn:db-password-do-not-leak@db.internal:5432/vyn";

const DEVELOPMENT: ServerEnv = { NODE_ENV: "development", DATABASE_URL: "file:./dev.db", AUTH_SECRET: "dev-secret" };
const PRODUCTION: ServerEnv = {
  NODE_ENV: "production",
  DATABASE_URL: DB_URL,
  AUTH_SECRET: SECRET,
  AUTH_URL: "https://vyn.example.org",
  ANTHROPIC_API_KEY: API_KEY,
  LLM_PROVIDER: "anthropic",
  LLM_MODEL: "claude-sonnet-5",
  NUTRITION_PROVIDER: "openfoodfacts",
  INTERNAL_REVIEW_EMAILS: "admin@example.com, Reviewer@Example.com",
};

function variables(env: ServerEnv): string[] {
  return findConfigProblems(env).map((problem) => problem.variable);
}

afterEach(() => vi.restoreAllMocks());

describe("findConfigProblems: Entwicklung", () => {
  it("akzeptiert eine minimale Entwicklungs-Konfiguration ohne API-Key, AUTH_URL oder Allowlist", () => {
    expect(findConfigProblems(DEVELOPMENT)).toEqual([]);
  });

  it("akzeptiert gültige optionale Werte", () => {
    const env = { ...DEVELOPMENT, LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-opus-5-5", NUTRITION_PROVIDER: "openfoodfacts", AUTH_TRUST_HOST: "true", INTERNAL_REVIEW_EMAILS: "dev@example.com" };
    expect(findConfigProblems(env)).toEqual([]);
  });

  it("verlangt DATABASE_URL und AUTH_SECRET auch in der Entwicklung (ohne sie funktioniert nichts)", () => {
    expect(variables({ NODE_ENV: "development" })).toEqual(["DATABASE_URL", "AUTH_SECRET"]);
    expect(variables({ ...DEVELOPMENT, DATABASE_URL: "   ", AUTH_SECRET: "" })).toEqual(["DATABASE_URL", "AUTH_SECRET"]);
  });
});

describe("findConfigProblems: Produktion", () => {
  it("akzeptiert eine vollständige Produktions-Konfiguration", () => {
    expect(findConfigProblems(PRODUCTION)).toEqual([]);
  });

  it("meldet fehlendes AUTH_SECRET", () => {
    expect(variables({ ...PRODUCTION, AUTH_SECRET: undefined })).toEqual(["AUTH_SECRET"]);
  });

  it("meldet ein zu kurzes AUTH_SECRET", () => {
    expect(variables({ ...PRODUCTION, AUTH_SECRET: "kurz" })).toEqual(["AUTH_SECRET"]);
  });

  it("meldet fehlende oder unbrauchbare DATABASE_URL", () => {
    expect(variables({ ...PRODUCTION, DATABASE_URL: undefined })).toEqual(["DATABASE_URL"]);
    expect(variables({ ...PRODUCTION, DATABASE_URL: "dev.db" })).toEqual(["DATABASE_URL"]);
  });

  it("verlangt AUTH_URL oder AUTH_TRUST_HOST=true, außer die Plattform vertraut dem Host selbst", () => {
    const withoutAuthUrl = { ...PRODUCTION, AUTH_URL: undefined };
    expect(variables(withoutAuthUrl)).toEqual(["AUTH_URL"]);
    expect(findConfigProblems({ ...withoutAuthUrl, AUTH_TRUST_HOST: "true" })).toEqual([]);
    expect(findConfigProblems({ ...withoutAuthUrl, VERCEL: "1" })).toEqual([]);
  });

  it('weist AUTH_TRUST_HOST="false" ab, weil Auth.js ihn als "true" behandeln würde', () => {
    expect(variables({ ...PRODUCTION, AUTH_TRUST_HOST: "false" })).toEqual(["AUTH_TRUST_HOST"]);
  });

  it("weist eine AUTH_URL ab, die keine http(s)-URL ist", () => {
    expect(variables({ ...PRODUCTION, AUTH_URL: "vyn.example.org" })).toEqual(["AUTH_URL"]);
  });

  it("verlangt den Anthropic-Key nur in Produktion", () => {
    expect(variables({ ...PRODUCTION, ANTHROPIC_API_KEY: "" })).toEqual(["ANTHROPIC_API_KEY"]);
    expect(variables({ ...DEVELOPMENT, ANTHROPIC_API_KEY: "" })).toEqual([]);
  });
});

describe("findConfigProblems: unterstützte Werte", () => {
  it("weist einen unbekannten LLM_PROVIDER ab und prüft dann weder Modell noch Key", () => {
    expect(variables({ ...PRODUCTION, LLM_PROVIDER: "openai", LLM_MODEL: "gpt-x", ANTHROPIC_API_KEY: undefined })).toEqual(["LLM_PROVIDER"]);
  });

  it("weist ein unbekanntes LLM_MODEL ab (z.B. Tippfehler)", () => {
    expect(variables({ ...PRODUCTION, LLM_MODEL: "claude-sonet-5" })).toEqual(["LLM_MODEL"]);
    expect(isSupportedLlmModel("claude-sonnet-5")).toBe(true);
    expect(isSupportedLlmModel("claude-sonet-5")).toBe(false);
  });

  it("weist einen unbekannten NUTRITION_PROVIDER ab", () => {
    expect(variables({ ...DEVELOPMENT, NUTRITION_PROVIDER: "usda" })).toEqual(["NUTRITION_PROVIDER"]);
  });

  it("meldet Allowlist-Einträge, die keine E-Mail-Adresse sind", () => {
    expect(variables({ ...PRODUCTION, INTERNAL_REVIEW_EMAILS: "admin@example.com, admin" })).toEqual(["INTERNAL_REVIEW_EMAILS"]);
  });
});

describe("Meldungen enthalten keine Werte", () => {
  it("nennt nur Variablennamen, nie Secrets, Keys oder Datenbank-URLs", () => {
    const leaky: ServerEnv = {
      NODE_ENV: "production",
      DATABASE_URL: "no-scheme-db-password-do-not-leak",
      AUTH_SECRET: "short-leak",
      AUTH_URL: "not a url with password-do-not-leak",
      AUTH_TRUST_HOST: "maybe-leak",
      LLM_MODEL: "model-leak",
      NUTRITION_PROVIDER: "provider-leak",
      INTERNAL_REVIEW_EMAILS: "not-an-email-leak",
    };
    const text = JSON.stringify(findConfigProblems(leaky));
    for (const value of Object.values(leaky).filter((v) => v !== "production")) expect(text).not.toContain(value);
    expect(text).not.toMatch(/leak/);
  });
});

describe("checkServerConfigAtStartup", () => {
  it("bricht in Produktion mit einem ServerConfigError ab, der keine Werte enthält", () => {
    const env = { ...PRODUCTION, AUTH_SECRET: undefined, LLM_MODEL: "claude-sonet-5" };
    let error: unknown;
    try {
      checkServerConfigAtStartup(env);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ServerConfigError);
    const message = (error as Error).message;
    expect(message).toContain("AUTH_SECRET");
    expect(message).toContain("LLM_MODEL");
    expect(message).not.toContain(API_KEY);
    expect(message).not.toContain(DB_URL);
  });

  it("läuft in der Entwicklung trotz Problemen weiter und warnt nur", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => checkServerConfigAtStartup({ ...DEVELOPMENT, LLM_PROVIDER: "openai" })).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("LLM_PROVIDER");
  });

  it("bleibt bei gültiger Konfiguration still", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => checkServerConfigAtStartup(PRODUCTION)).not.toThrow();
    expect(() => checkServerConfigAtStartup(DEVELOPMENT)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("parseInternalReviewEmails", () => {
  it("normalisiert Groß-/Kleinschreibung und Leerzeichen und zählt ungültige Einträge", () => {
    expect(parseInternalReviewEmails(" Admin@Example.com ,, reviewer@example.com, admin ")).toEqual({
      emails: ["admin@example.com", "reviewer@example.com"],
      invalidEntryCount: 1,
    });
    expect(parseInternalReviewEmails(undefined)).toEqual({ emails: [], invalidEntryCount: 0 });
  });
});

describe("mockRecipeSourcesAllowed", () => {
  it("ist nur in Produktion gesperrt", () => {
    expect(mockRecipeSourcesAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(mockRecipeSourcesAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(mockRecipeSourcesAllowed({ NODE_ENV: "test" })).toBe(true);
  });
});
