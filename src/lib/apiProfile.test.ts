import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseFixtures } from "@/test/databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "@/test/isolatedDatabase";

/**
 * Profil-Lookup für API-Routen (R5F-12) gegen eine isolierte SQLite-Datenbank. Die Anmeldung prüft die
 * Route selbst (getApiUserId -> 401, siehe Route-Tests); der Helper bekommt nur die User-ID der Session.
 * prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f12-api-profile-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { findApiProfileId, requireApiProfileId } = await import("./apiProfile");
const { createPerson, clearFixtureData } = databaseFixtures(prisma);

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
});

/** Zwei Nutzer mit Profil und einer ohne - der gesuchte Nutzer ist nie der zuerst angelegte. */
async function threeUsers() {
  const other = await createPerson("B");
  const signedIn = await createPerson("A");
  const withoutProfile = await prisma.user.create({ data: { name: "C" } });
  return { other, signedIn, withoutProfile };
}

describe("findApiProfileId (R5F-12)", () => {
  it("liefert genau das Profil des angemeldeten Nutzers, nicht das eines anderen", async () => {
    const { other, signedIn } = await threeUsers();

    expect(await findApiProfileId(signedIn.user.id)).toBe(signedIn.profile.id);
    expect(await findApiProfileId(other.user.id)).toBe(other.profile.id);
  });

  it("liefert null für einen angemeldeten Nutzer ohne Profil und für eine unbekannte User-ID", async () => {
    const { withoutProfile } = await threeUsers();

    expect(await findApiProfileId(withoutProfile.id)).toBeNull();
    expect(await findApiProfileId("unbekannt")).toBeNull();
  });
});

describe("requireApiProfileId (R5F-12)", () => {
  it("mit Profil: ok samt Profil-ID", async () => {
    const { signedIn } = await threeUsers();

    expect(await requireApiProfileId(signedIn.user.id)).toEqual({ ok: true, profileId: signedIn.profile.id });
  });

  it("ohne Profil: die gemeinsame Antwort 404 'Kein Profil vorhanden.'", async () => {
    const { withoutProfile } = await threeUsers();

    const lookup = await requireApiProfileId(withoutProfile.id);

    expect(lookup.ok).toBe(false);
    if (lookup.ok) return;
    expect(lookup.response.status).toBe(404);
    expect(await lookup.response.json()).toEqual({ error: "Kein Profil vorhanden." });
  });
});
