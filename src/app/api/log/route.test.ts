import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "@/test/databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "@/test/isolatedDatabase";

/**
 * /api/log gegen eine isolierte SQLite-Datenbank (R5F-2): Ein Log-Eintrag darf nur auf Rezepte
 * verweisen, die das Profil sehen darf (Katalog oder eigene, recipeVisibility.ts), und GET legt keine
 * fremden privaten Rezepte offen. Nur die Session ist ersetzt; prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f2-log-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { DELETE, GET, POST } = await import("./route");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

const DAY = "2026-09-24";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
  session.userId = null;
});

async function signedInPerson(name = "A") {
  const person = await createPerson(name);
  session.userId = person.user.id;
  return person;
}

function logRequest(recipeId?: string) {
  const body = { date: DAY, slot: "LUNCH", ...(recipeId ? { recipeId } : {}), customName: "Mittagessen", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 };
  return new Request("http://localhost/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/log: nur sichtbare Rezepte (R5F-2)", () => {
  it.each([
    ["ein Katalogrezept", undefined],
    ["ein eigenes privates Rezept", "own"],
  ] as const)("loggt %s", async (_label, ownership) => {
    const { profile } = await signedInPerson();
    const recipe = await createRecipe("Reis-Bowl", ownership === "own" ? profile.id : undefined);

    const res = await POST(logRequest(recipe.id));

    expect(res.status).toBe(200);
    const { entry } = await res.json();
    expect(entry).toMatchObject({ profileId: profile.id, recipeId: recipe.id, kcal: 450 });
    expect(await prisma.logEntry.count({ where: { profileId: profile.id } })).toBe(1);
  });

  it("lehnt ein fremdes privates Rezept mit 404 ab und schreibt keinen Eintrag", async () => {
    const other = await createPerson("B");
    const foreign = await createRecipe("Geheimrezept", other.profile.id);
    const { profile } = await signedInPerson();

    const res = await POST(logRequest(foreign.id));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Rezept nicht gefunden." });
    expect(await prisma.logEntry.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("antwortet auf eine unbekannte recipeId genauso (404 statt 500) und schreibt keinen Eintrag", async () => {
    const { profile } = await signedInPerson();

    const res = await POST(logRequest("gibt-es-nicht"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Rezept nicht gefunden." });
    expect(await prisma.logEntry.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("ein freier Eintrag ohne recipeId funktioniert wie bisher", async () => {
    const { profile } = await signedInPerson();

    const res = await POST(logRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).entry).toMatchObject({ profileId: profile.id, recipeId: null, customName: "Mittagessen" });
  });
});

describe("GET /api/log: keine fremden privaten Rezepte (R5F-2)", () => {
  function getRequest() {
    return new Request(`http://localhost/api/log?date=${DAY}`);
  }

  async function logEntryFor(profileId: string, recipeId: string | null) {
    return prisma.logEntry.create({
      data: { profileId, date: toDbDate(DAY), slot: "LUNCH", recipeId, customName: "Eintrag", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 },
    });
  }

  it("liefert eigene und Katalogrezepte mit, ein fremdes privates Rezept (z.B. aus Altdaten) nicht", async () => {
    const other = await createPerson("B");
    const foreign = await createRecipe("Geheimrezept", other.profile.id);
    const { profile } = await signedInPerson();
    const own = await createRecipe("Eigene Bowl", profile.id);
    const catalog = await createRecipe("Katalog-Bowl");
    await logEntryFor(profile.id, own.id);
    await logEntryFor(profile.id, catalog.id);
    // Vor R5F-2 konnte POST eine fremde recipeId speichern; solche Einträge dürfen das Rezept nicht offenlegen.
    await logEntryFor(profile.id, foreign.id);

    const res = await GET(getRequest());

    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries.map((e: { recipe: { name: string } | null }) => e.recipe?.name ?? null).sort()).toEqual([null, "Eigene Bowl", "Katalog-Bowl"].sort());
    expect(JSON.stringify(entries)).not.toContain("Geheimrezept");
    // Der Eintrag selbst (was gegessen wurde) bleibt vollständig.
    expect(entries).toHaveLength(3);
  });

  it("ein inzwischen gelöschtes Rezept führt zu recipe: null, nicht zu einem Fehler", async () => {
    const { profile } = await signedInPerson();
    const own = await createRecipe("Eigene Bowl", profile.id);
    await logEntryFor(profile.id, own.id);
    await prisma.recipe.delete({ where: { id: own.id } }); // LogEntry.recipeId: SetNull

    const res = await GET(getRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).entries).toEqual([expect.objectContaining({ recipeId: null, recipe: null, kcal: 450 })]);
  });
});

describe("GET /api/log: Anmeldung und eigene Einträge (R5F-12)", () => {
  function getRequest(date: string = DAY) {
    return new Request(`http://localhost/api/log?date=${date}`);
  }

  function logEntryFor(profileId: string, customName: string, date: CalendarDate = DAY) {
    return prisma.logEntry.create({
      data: { profileId, date: toDbDate(date), slot: "LUNCH", customName, kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 },
    });
  }

  it("ohne Anmeldung 401 statt einer leeren Erfolgsliste", async () => {
    await logEntryFor((await createPerson("A")).profile.id, "Mittagessen");

    const res = await GET(getRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Nicht angemeldet." });
  });

  it("ein ungültiges Datum bleibt wie bisher 400 - auch ohne Anmeldung", async () => {
    expect((await GET(getRequest("24.09.2026"))).status).toBe(400);
  });

  it("liefert genau die eigenen Einträge des Tages, in Anlegereihenfolge - keine fremden, keine anderer Tage", async () => {
    const other = await createPerson("B");
    await logEntryFor(other.profile.id, "Fremder Eintrag");
    const { profile } = await signedInPerson();
    await logEntryFor(profile.id, "Frühstück");
    await logEntryFor(profile.id, "Mittagessen");
    await logEntryFor(profile.id, "Gestern", "2026-09-23");

    const res = await GET(getRequest());

    expect(res.status).toBe(200);
    const { entries } = await res.json();
    expect(entries.map((e: { customName: string }) => e.customName)).toEqual(["Frühstück", "Mittagessen"]);
    expect(entries.every((e: { profileId: string }) => e.profileId === profile.id)).toBe(true);
  });

  it("angemeldet ohne Profil: wie bisher 200 mit leerer Liste", async () => {
    const user = await prisma.user.create({ data: { name: "Ohne Profil" } });
    session.userId = user.id;

    const res = await GET(getRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });
});

describe("POST/DELETE /api/log: Profil aus der Session (R5F-12)", () => {
  it("ohne Profil 404 'Kein Profil vorhanden.'; eine ungültige Eingabe bleibt dabei wie bisher 400", async () => {
    const user = await prisma.user.create({ data: { name: "Ohne Profil" } });
    session.userId = user.id;

    const res = await POST(logRequest());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Kein Profil vorhanden." });

    const invalid = new Request("http://localhost/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: DAY }) });
    expect((await POST(invalid)).status).toBe(400);
    expect(await prisma.logEntry.count()).toBe(0);
  });

  it("ein fremder Eintrag lässt sich nicht löschen", async () => {
    const other = await createPerson("B");
    const foreign = await prisma.logEntry.create({
      data: { profileId: other.profile.id, date: toDbDate(DAY), slot: "LUNCH", customName: "Fremd", kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 },
    });
    await signedInPerson();

    const res = await DELETE(new Request(`http://localhost/api/log?id=${foreign.id}`, { method: "DELETE" }));

    expect(res.status).toBe(200);
    expect(await prisma.logEntry.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });
});
