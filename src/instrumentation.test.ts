import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

/**
 * Anbindung der Konfigurationsprüfung an den Serverstart (F-21). Die Env-Werte werden nur per
 * `vi.stubEnv` für den jeweiligen Test gesetzt und danach zurückgesetzt.
 */
const INVALID_PRODUCTION = {
  NODE_ENV: "production",
  NEXT_RUNTIME: "nodejs",
  DATABASE_URL: "",
  AUTH_SECRET: "",
};

function stubAll(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("register", () => {
  it("bricht den Produktionsstart bei ungültiger Konfiguration ab", async () => {
    stubAll({ ...INVALID_PRODUCTION, NEXT_PHASE: "" });
    await expect(register()).rejects.toThrow(/DATABASE_URL[\s\S]*AUTH_SECRET/);
  });

  it("prüft nicht während next build (die Build-Umgebung braucht keine Secrets)", async () => {
    stubAll({ ...INVALID_PRODUCTION, NEXT_PHASE: "phase-production-build" });
    await expect(register()).resolves.toBeUndefined();
  });

  it("prüft nicht in der Edge-Runtime", async () => {
    stubAll({ ...INVALID_PRODUCTION, NEXT_RUNTIME: "edge", NEXT_PHASE: "" });
    await expect(register()).resolves.toBeUndefined();
  });

  it("startet in der Entwicklung trotz Problemen und warnt nur", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubAll({ ...INVALID_PRODUCTION, NODE_ENV: "development", NEXT_PHASE: "" });
    await expect(register()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
