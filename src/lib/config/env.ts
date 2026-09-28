/**
 * Zentrale Prüfung der Server-Konfiguration (F-21). Reine Funktionen über ein Env-Objekt: kein
 * Datenbankzugriff, kein Netzwerk, keine Seiteneffekte außer dem Log/Fehler in
 * `checkServerConfigAtStartup` (aufgerufen aus `src/instrumentation.ts` beim Serverstart).
 *
 * - Produktion (`NODE_ENV=production`): jeder gefundene Fehler bricht den Start ab.
 * - Sonst (Entwicklung, Tests): Fehler werden als Warnung geloggt, der Start läuft weiter. Optionale
 *   Produktions-Konfiguration (z.B. `ANTHROPIC_API_KEY`) ist dort nicht nötig.
 *
 * Meldungen nennen nur den Variablennamen, nie den Wert (keine Secrets oder Datenbank-URLs im Log).
 * Sie sind ausschließlich für das Server-Log gedacht, nie für Client-Antworten.
 */

export type ServerEnv = Readonly<Record<string, string | undefined>>;

/** Muss zu den Fällen in `getLLMProvider()` (src/lib/agents/llmProvider.ts) passen. */
export const SUPPORTED_LLM_PROVIDERS = ["anthropic"] as const;

/** Claude-Modelle, mit denen der Food Assistant betrieben werden darf. Neue Modelle hier ergänzen. */
export const SUPPORTED_ANTHROPIC_MODELS = ["claude-sonnet-5", "claude-opus-5-5", "claude-fable-5-1", "claude-haiku-4-5-20251001"] as const;
export const DEFAULT_LLM_MODEL = "claude-sonnet-5";

/** Muss zu den Fällen in `getNutritionProvider()` (src/lib/providers/nutritionProvider.ts) passen. */
export const SUPPORTED_NUTRITION_PROVIDERS = ["openfoodfacts"] as const;

/** Auth.js empfiehlt mindestens 32 Zeichen; `openssl rand -base64 32` liefert 44. */
const MIN_PRODUCTION_AUTH_SECRET_LENGTH = 32;

const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

export interface ConfigProblem {
  variable: string;
  /** Beschreibt das Problem, ohne den Wert der Variable zu enthalten. */
  message: string;
}

export class ServerConfigError extends Error {}

export function isProductionRuntime(env: ServerEnv = process.env): boolean {
  return env.NODE_ENV === "production";
}

/**
 * Mock-Rezeptquellen (feste Import-Fixtures) sind Entwicklungs-/Testdaten und in Produktion weder
 * importierbar noch veröffentlichbar (F-15).
 */
export function mockRecipeSourcesAllowed(env: ServerEnv = process.env): boolean {
  return !isProductionRuntime(env);
}

export function isSupportedLlmModel(model: string): boolean {
  return (SUPPORTED_ANTHROPIC_MODELS as readonly string[]).includes(model);
}

/**
 * Liest die Allowlist für interne Werkzeuge (F-07): kommagetrennte E-Mail-Adressen, klein
 * geschrieben. Einträge, die keine E-Mail-Adresse sind, gewähren nie Zugriff und werden gezählt.
 */
export function parseInternalReviewEmails(value: string | undefined): { emails: string[]; invalidEntryCount: number } {
  const entries = (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const emails = entries.filter((entry) => EMAIL_PATTERN.test(entry));
  return { emails, invalidEntryCount: entries.length - emails.length };
}

function readValue(env: ServerEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function databaseProblems(env: ServerEnv): ConfigProblem[] {
  const url = readValue(env, "DATABASE_URL");
  if (!url) return [{ variable: "DATABASE_URL", message: "fehlt." }];
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return [{ variable: "DATABASE_URL", message: "ist keine Verbindungs-URL (erwartet z.B. file:… oder postgresql://…)." }];
  }
  return [];
}

function authProblems(env: ServerEnv, production: boolean): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const secret = readValue(env, "AUTH_SECRET");
  if (!secret) problems.push({ variable: "AUTH_SECRET", message: "fehlt." });
  else if (production && secret.length < MIN_PRODUCTION_AUTH_SECRET_LENGTH) {
    problems.push({ variable: "AUTH_SECRET", message: `ist zu kurz (mindestens ${MIN_PRODUCTION_AUTH_SECRET_LENGTH} Zeichen in Produktion).` });
  }

  const authUrl = readValue(env, "AUTH_URL");
  if (authUrl && !isHttpUrl(authUrl)) problems.push({ variable: "AUTH_URL", message: "ist keine gültige http(s)-URL." });

  const trustHost = readValue(env, "AUTH_TRUST_HOST");
  // Auth.js wertet JEDEN nicht leeren Wert als "vertrauen" - auch "false". Deshalb nur "true" zulassen.
  if (trustHost && trustHost !== "true") {
    problems.push({ variable: "AUTH_TRUST_HOST", message: 'muss "true" sein oder fehlen (Auth.js behandelt jeden anderen Wert ebenfalls als "true").' });
  }

  // Wie Auth.js selbst: auf Vercel/Cloudflare Pages wird dem Host automatisch vertraut.
  const hostTrustedByPlatform = Boolean(readValue(env, "VERCEL") ?? readValue(env, "CF_PAGES"));
  if (production && !authUrl && !trustHost && !hostTrustedByPlatform) {
    problems.push({ variable: "AUTH_URL", message: "oder AUTH_TRUST_HOST=true ist in Produktion nötig, sonst lehnt Auth.js jede Anfrage ab (UntrustedHost)." });
  }
  return problems;
}

function assistantProblems(env: ServerEnv, production: boolean): ConfigProblem[] {
  const provider = readValue(env, "LLM_PROVIDER") ?? "anthropic";
  if (!(SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(provider)) {
    return [{ variable: "LLM_PROVIDER", message: `wird nicht unterstützt (unterstützt: ${SUPPORTED_LLM_PROVIDERS.join(", ")}).` }];
  }

  const problems: ConfigProblem[] = [];
  const model = readValue(env, "LLM_MODEL");
  if (model && !isSupportedLlmModel(model)) {
    problems.push({ variable: "LLM_MODEL", message: `wird nicht unterstützt (unterstützt: ${SUPPORTED_ANTHROPIC_MODELS.join(", ")}).` });
  }
  // Außerhalb von Produktion darf der Key fehlen: der Assistant antwortet dann kontrolliert mit 503.
  if (production && provider === "anthropic" && !readValue(env, "ANTHROPIC_API_KEY")) {
    problems.push({ variable: "ANTHROPIC_API_KEY", message: 'fehlt, ist für LLM_PROVIDER "anthropic" in Produktion aber Pflicht.' });
  }
  return problems;
}

function nutritionProblems(env: ServerEnv): ConfigProblem[] {
  const provider = readValue(env, "NUTRITION_PROVIDER");
  if (provider && !(SUPPORTED_NUTRITION_PROVIDERS as readonly string[]).includes(provider)) {
    return [{ variable: "NUTRITION_PROVIDER", message: `wird nicht unterstützt (unterstützt: ${SUPPORTED_NUTRITION_PROVIDERS.join(", ")}).` }];
  }
  return [];
}

function internalReviewProblems(env: ServerEnv): ConfigProblem[] {
  const { invalidEntryCount } = parseInternalReviewEmails(env.INTERNAL_REVIEW_EMAILS);
  if (invalidEntryCount === 0) return [];
  return [{ variable: "INTERNAL_REVIEW_EMAILS", message: `enthält ${invalidEntryCount} Eintrag/Einträge, die keine E-Mail-Adresse sind (erwartet: kommagetrennte E-Mail-Adressen).` }];
}

/** Alle Konfigurationsprobleme für die Umgebung, die `NODE_ENV` in `env` beschreibt. */
export function findConfigProblems(env: ServerEnv = process.env): ConfigProblem[] {
  const production = isProductionRuntime(env);
  return [
    ...databaseProblems(env),
    ...authProblems(env, production),
    ...assistantProblems(env, production),
    ...nutritionProblems(env),
    ...internalReviewProblems(env),
  ];
}

/** Beim Serverstart: in Produktion Abbruch bei jedem Problem, sonst nur eine Warnung im Log. */
export function checkServerConfigAtStartup(env: ServerEnv = process.env): void {
  const problems = findConfigProblems(env);
  if (problems.length === 0) return;

  const summary = problems.map((problem) => `- ${problem.variable} ${problem.message}`).join("\n");
  if (isProductionRuntime(env)) {
    throw new ServerConfigError(`Ungültige Server-Konfiguration, Start abgebrochen (siehe README, "Umgebungsvariablen"):\n${summary}`);
  }
  console.warn(`[config] Konfiguration unvollständig oder ungültig, Start wird fortgesetzt:\n${summary}`);
}
