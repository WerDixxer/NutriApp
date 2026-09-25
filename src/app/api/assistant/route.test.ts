import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseFixtures } from "@/test/databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "@/test/isolatedDatabase";

/**
 * POST /api/assistant gegen eine isolierte SQLite-Datenbank: Request-Body (F-19) sowie Limits,
 * Sperre gegen parallele Anfragen und Fehlerpfade (F-20). Die echte Assistant-Pipeline läuft;
 * ersetzt sind nur die Session und der LLM-Provider (zählt Aufrufe, lässt sich anhalten oder
 * scheitern lassen). prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5b-assistant-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

type ChatResult = { content: { type: "text"; text: string }[]; stopReason: string };
const TEXT_RESPONSE: ChatResult = { content: [{ type: "text", text: "Antwort vom Assistenten" }], stopReason: "end_turn" };
const llm = vi.hoisted(() => ({
  calls: 0,
  chat: null as null | (() => Promise<ChatResult>),
  providerError: null as Error | null,
}));
vi.mock("@/lib/agents/llmProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/llmProvider")>();
  return {
    ...actual,
    getLLMProvider: () => {
      if (llm.providerError) throw llm.providerError;
      return {
        name: "fake",
        chat: () => {
          llm.calls++;
          return llm.chat!();
        },
      };
    },
  };
});

const { prisma } = await import("@/lib/db");
const { POST } = await import("./route");
const { LLMConfigError, LLMTimeoutError } = await import("@/lib/agents/llmProvider");
const { STALE_ACTIVE_REQUEST_MS } = await import("@/lib/agents/assistantUsage");
const { createPerson, clearFixtureData } = databaseFixtures(prisma);

const HOUR = 60 * 60 * 1000;
const INVALID_JSON_MESSAGE = "Ungültige Anfrage: Der Inhalt ist kein gültiges JSON.";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

let userId: string;

beforeEach(async () => {
  await clearFixtureData(); // löscht User -> Cascade auf AssistantRequest und (über das Profil) AssistantMessage
  const person = await createPerson("A");
  userId = person.user.id;
  session.userId = userId;
  llm.calls = 0;
  llm.chat = async () => TEXT_RESPONSE;
  llm.providerError = null;
});

function post(body: string | undefined = JSON.stringify({ message: "Was esse ich heute?" })): Request {
  return new Request("http://localhost/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, body });
}

/** Anzahl gezählter (zugelassener) Assistant-Anfragen des Nutzers. */
function countedRequests(forUserId = userId) {
  return prisma.assistantRequest.count({ where: { userId: forUserId } });
}

function activeRequests() {
  return prisma.assistantRequest.count({ where: { activeUserId: { not: null } } });
}

/** Frühere, abgeschlossene Anfragen zu festen Zeitpunkten vor jetzt. */
async function seedEarlierRequests(msAgoList: number[]) {
  const now = Date.now();
  await prisma.assistantRequest.createMany({
    data: msAgoList.map((msAgo) => ({ userId, startedAt: new Date(now - msAgo), finishedAt: new Date(now - msAgo + 1000) })),
  });
}

/** LLM-Aufruf, der erst nach `release()` antwortet - hält eine Anfrage bewusst aktiv. */
function blockingLlm() {
  let release!: () => void;
  let markStarted!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (markStarted = resolve));
  llm.chat = async () => {
    markStarted();
    await released;
    return TEXT_RESPONSE;
  };
  return { started, release };
}

// ---------------------------------------------------------------------------
// Anmeldung und Eingabe: werden vor der Zulassung abgelehnt und zählen nie
// ---------------------------------------------------------------------------

describe("POST /api/assistant: Anmeldung und Eingabe", () => {
  it("ohne Session 401 (auch mit kaputtem Body), nichts wird gezählt", async () => {
    session.userId = null;
    expect((await POST(post())).status).toBe(401);
    expect((await POST(post("{kaputt"))).status).toBe(401);
    expect(await countedRequests()).toBe(0);
  });

  it.each([
    ["kaputtem JSON", "{kaputt"],
    ["leerem Body", ""],
  ])("bei %s 400, kein LLM-Aufruf, nichts wird gezählt", async (_label, body) => {
    const res = await POST(post(body));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: INVALID_JSON_MESSAGE });
    expect(llm.calls).toBe(0);
    expect(await countedRequests()).toBe(0);
  });

  it("ungültige Struktur und Nachrichten über 2.000 Zeichen bekommen weiterhin die Meldung des Schemas und zählen nicht", async () => {
    const wrongShape = await POST(post('{"foo":"bar"}'));
    const tooLong = await POST(post(JSON.stringify({ message: "x".repeat(2001) })));

    expect(wrongShape.status).toBe(400);
    expect((await wrongShape.json()).error).not.toBe(INVALID_JSON_MESSAGE);
    expect(tooLong.status).toBe(400);
    expect((await tooLong.json()).error).toContain("zu lang");
    expect(llm.calls).toBe(0);
    expect(await countedRequests()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Normaler Ablauf
// ---------------------------------------------------------------------------

describe("POST /api/assistant: zugelassene Anfrage", () => {
  it("läuft unverändert durch: höchstens 2 LLM-Aufrufe, genau 1 gezählte Anfrage, Sperre danach frei", async () => {
    const res = await POST(post());

    expect(res.status).toBe(200);
    expect((await res.json()).reply).toBe("Antwort vom Assistenten");
    expect(llm.calls).toBe(2); // Extraktion + freie Antwort
    expect(await countedRequests()).toBe(1);
    expect(await activeRequests()).toBe(0);
    expect((await prisma.assistantRequest.findFirstOrThrow({ where: { userId } })).finishedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Limits: 20 pro Stunde, 100 pro 24 Stunden
// ---------------------------------------------------------------------------

describe("POST /api/assistant: Limits pro Nutzer", () => {
  it("die 20. Anfrage der Stunde geht noch, die 21. bekommt 429 mit Retry-After und zählt nicht", async () => {
    await seedEarlierRequests(Array.from({ length: 19 }, (_, i) => 50 * 60_000 - i * 1000)); // vor ca. 50 Minuten

    expect((await POST(post())).status).toBe(200);
    const blocked = await POST(post());

    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "Du hast das Limit für Assistant-Anfragen erreicht. Versuch es später noch einmal." });
    // Die älteste der 20 Anfragen fällt nach ca. 10 Minuten aus dem Fenster.
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(9 * 60);
    expect(retryAfter).toBeLessThanOrEqual(10 * 60);
    expect(await countedRequests()).toBe(20);
    expect(llm.calls).toBe(2); // nur die zugelassene Anfrage hat das LLM erreicht
    expect(await activeRequests()).toBe(0);
  });

  it("Anfragen, die älter als eine Stunde sind, zählen nicht mehr für das Stundenlimit", async () => {
    await seedEarlierRequests(Array.from({ length: 20 }, (_, i) => HOUR + 60_000 + i * 1000));
    expect((await POST(post())).status).toBe(200);
  });

  it("die 100. Anfrage in 24 Stunden geht noch, die 101. bekommt 429 - auch wenn die Stunde frei ist", async () => {
    // 99 Anfragen zwischen 2 und 23 Stunden alt: das Stundenfenster ist leer.
    await seedEarlierRequests(Array.from({ length: 99 }, (_, i) => 23 * HOUR - i * 10 * 60_000));

    expect((await POST(post())).status).toBe(200);
    const blocked = await POST(post());

    expect(blocked.status).toBe(429);
    // Die älteste (23 Stunden) fällt nach ca. 1 Stunde aus dem 24-Stunden-Fenster.
    const retryAfter = Number(blocked.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(59 * 60);
    expect(retryAfter).toBeLessThanOrEqual(60 * 60);
    expect(await countedRequests()).toBe(100);
  });

  it("die Limits gelten pro Nutzer", async () => {
    await seedEarlierRequests(Array.from({ length: 20 }, () => 60_000));
    const other = await createPerson("B");
    session.userId = other.user.id;

    expect((await POST(post())).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Höchstens eine aktive Anfrage pro Nutzer
// ---------------------------------------------------------------------------

describe("POST /api/assistant: parallele Anfragen desselben Nutzers", () => {
  it("während eine Anfrage läuft, bekommt die zweite 429 und zählt nicht; danach geht es wieder", async () => {
    const llmCall = blockingLlm();
    const first = POST(post());
    await llmCall.started;

    const second = await POST(post());
    expect(second.status).toBe(429);
    expect(await second.json()).toEqual({ error: "Dein Assistent beantwortet gerade noch eine Anfrage. Warte kurz, bis sie fertig ist." });
    expect(second.headers.get("Retry-After")).toBeNull();

    llmCall.release();
    expect((await first).status).toBe(200);
    expect(await countedRequests()).toBe(1);

    llm.chat = async () => TEXT_RESPONSE;
    expect((await POST(post())).status).toBe(200);
    expect(await countedRequests()).toBe(2);
  });

  it("exakt gleichzeitig: genau eine Anfrage startet den Assistant, die andere bekommt 429", async () => {
    const llmCall = blockingLlm();
    const both = Promise.all([POST(post()), POST(post())]);
    await llmCall.started;
    llmCall.release();

    const statuses = (await both).map((res) => res.status).sort();
    expect(statuses).toEqual([200, 429]);
    expect(await countedRequests()).toBe(1);
    expect(llm.calls).toBe(2);
    expect(await activeRequests()).toBe(0);
  });

  it("eine aktive Anfrage eines anderen Nutzers blockiert nicht", async () => {
    const llmCall = blockingLlm();
    const first = POST(post());
    await llmCall.started;
    const other = await createPerson("B");
    session.userId = other.user.id;
    llm.chat = async () => TEXT_RESPONSE; // die zweite Anfrage antwortet sofort

    expect((await POST(post())).status).toBe(200);
    llmCall.release();
    expect((await first).status).toBe(200);
  });

  it("eine verwaiste Sperre (Prozess abgestürzt) blockiert nach der Stale-Zeit nicht mehr", async () => {
    const orphanStart = new Date(Date.now() - STALE_ACTIVE_REQUEST_MS - 60_000);
    const orphan = await prisma.assistantRequest.create({ data: { userId, startedAt: orphanStart, activeUserId: userId } });

    expect((await POST(post())).status).toBe(200);
    expect(await prisma.assistantRequest.findUniqueOrThrow({ where: { id: orphan.id } })).toMatchObject({ activeUserId: null });
    expect(await activeRequests()).toBe(0);
  });

  it("eine frische aktive Sperre blockiert weiterhin", async () => {
    await prisma.assistantRequest.create({ data: { userId, startedAt: new Date(Date.now() - 60_000), activeUserId: userId } });
    expect((await POST(post())).status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Fehlerpfade: kontrollierte Antworten, Sperre wird immer freigegeben
// ---------------------------------------------------------------------------

describe("POST /api/assistant: Fehlerpfade", () => {
  it("LLM-Fehler: 500 ohne interne Details, Sperre frei, die Anfrage zählt", async () => {
    llm.chat = async () => {
      throw new Error("Anthropic 529 overloaded_error model claude-sonnet-5 request_id=req_123");
    };
    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Der Assistent hatte gerade ein Problem. Versuch es nochmal." });
    expect(JSON.stringify(body)).not.toMatch(/claude|anthropic|req_/i);
    expect(await activeRequests()).toBe(0);
    expect(await countedRequests()).toBe(1);

    llm.chat = async () => TEXT_RESPONSE;
    expect((await POST(post())).status).toBe(200);
  });

  it("LLM-Timeout: 504 mit kurzer Meldung, Sperre frei", async () => {
    llm.chat = async () => {
      throw new LLMTimeoutError("LLM-Anfrage hat das Timeout überschritten.");
    };
    const res = await POST(post());

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "Der Assistent hat zu lange gebraucht. Versuch es gleich nochmal." });
    expect(await activeRequests()).toBe(0);
  });

  it("fehlende Konfiguration: 503 ohne Hinweis auf API-Key oder Modell, Sperre frei", async () => {
    llm.providerError = new LLMConfigError("ANTHROPIC_API_KEY fehlt. Trag deinen Anthropic API Key in die lokale .env-Datei ein.");
    const res = await POST(post());
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body).toEqual({ error: "Der Assistent ist gerade nicht verfügbar." });
    expect(await activeRequests()).toBe(0);
  });
});
