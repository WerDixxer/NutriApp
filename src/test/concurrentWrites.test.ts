import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fromDbDate, todayForUser } from "@/lib/calendarDate";
import { databaseFixtures, PLAN_DATE } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Parallele Schreibzugriffe gegen eine isolierte SQLite-Datenbank (R4C). Jeder Test startet zwei
 * Aufrufe gleichzeitig über denselben Prisma-Client - wie zwei Requests im selben Server-Prozess:
 * Beide lesen, bevor einer schreibt, und laufen so in das Check-then-Act-Rennen. Die Konflikte
 * meldet die Datenbank selbst (Unique-Index); ersetzt sind nur Session, Login und Next.js-Redirects.
 * prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r4c-races-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));
const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: async () => null, signIn, signOut: vi.fn() }));
// authActions.ts braucht aus next-auth nur die Fehlerklasse; das echte Paket lädt außerhalb von Next.js nicht.
vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan } = await import("@/lib/generateMealPlan");
const { registerAction, registerViaInviteAction, setupAccountAction } = await import("@/lib/authActions");
const { acceptInvite, createInvite } = await import("@/lib/household/inviteService");
const householdRoute = await import("@/app/api/household/route");
const { createPerson, createRecipe, createHousehold, clearFixtureData } = databaseFixtures(prisma);

const MONDAY_OF_PLAN_WEEK = "2026-09-21";
const EMAIL = "r4c@test.invalid";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
  session.userId = null;
  signIn.mockClear();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Wartet auf alle Aufrufe; Fehler bleiben als Ergebnis erhalten, statt die anderen Aufrufe zu verdecken. */
async function settleAll(calls: Promise<unknown>[]) {
  const results = await Promise.allSettled(calls);
  return {
    succeeded: results.filter((result) => result.status === "fulfilled").length,
    errors: results.flatMap((result) => (result.status === "rejected" ? [String(result.reason?.message ?? result.reason)] : [])),
  };
}

// ---------------------------------------------------------------------------
// R4-04: Tagesplan, @@unique([profileId, date])
// ---------------------------------------------------------------------------

describe("Tagesplan: zwei gleichzeitige Aufrufe für denselben Tag (R4-04)", () => {
  it("liefern beide denselben gespeicherten Plan; es entsteht genau ein Tagesplan", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");

    const [first, second] = await Promise.all([getOrGenerateDayPlan(profile.id, PLAN_DATE), getOrGenerateDayPlan(profile.id, PLAN_DATE)]);

    expect(second.id).toBe(first.id);
    expect(first.items.length).toBeGreaterThan(0);
    expect(second.items.map((item) => item.recipeId)).toEqual(first.items.map((item) => item.recipeId));
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
  });

  // F-10: Der Tag eines Requests ist der Kalendertag des Nutzers (todayForUser), nicht der UTC- oder Servertag.
  it("zwei gleichzeitige Requests um 00:30 und 01:30 Nutzerzeit (in UTC noch der Vortag) erhalten denselben Plan", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    const at0030 = todayForUser(new Date("2026-09-26T00:30:00+02:00"));
    const at0130 = todayForUser(new Date("2026-09-26T01:30:00+02:00"));

    const [first, second] = await Promise.all([getOrGenerateDayPlan(profile.id, at0030), getOrGenerateDayPlan(profile.id, at0130)]);

    expect(second.id).toBe(first.id);
    expect(fromDbDate(first.date)).toBe("2026-09-26");
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
  });

  it("zwei gleichzeitige Requests um 23:30 und 00:30 Nutzerzeit (in UTC derselbe Tag) erhalten zwei verschiedene Tage", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    const lateEvening = todayForUser(new Date("2026-09-25T23:30:00+02:00"));
    const afterMidnight = todayForUser(new Date("2026-09-26T00:30:00+02:00"));

    const [dayA, dayB] = await Promise.all([getOrGenerateDayPlan(profile.id, lateEvening), getOrGenerateDayPlan(profile.id, afterMidnight)]);

    expect(dayA.id).not.toBe(dayB.id);
    expect([fromDbDate(dayA.date), fromDbDate(dayB.date)]).toEqual(["2026-09-25", "2026-09-26"]);
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(2);
  });

  // Der Wochenplan erzeugt fehlende Tage über denselben getOrGenerateDayPlan()-Aufruf wie Dashboard,
  // /api/plan und Food Assistant; zwei gleichzeitige Wochen treffen deshalb dasselbe Rennen Tag für Tag.
  it("zwei gleichzeitige Wochenpläne (/plan in zwei Tabs): kein Fehler, jeder Tag genau einmal, beide zeigen dieselben Tage", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");

    const [firstWeek, secondWeek] = await Promise.all([
      getOrGenerateWeekPlan(profile.id, MONDAY_OF_PLAN_WEEK),
      getOrGenerateWeekPlan(profile.id, MONDAY_OF_PLAN_WEEK),
    ]);

    expect(secondWeek.map((day) => day.id)).toEqual(firstWeek.map((day) => day.id));
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// R4-05: Registrierung und eigener Haushalt
// ---------------------------------------------------------------------------

describe("Registrierung (R4-05)", () => {
  const registration = () => form({ name: "Alex", email: EMAIL, password: "sicheres-passwort" });

  it("zweimal gleichzeitig abgeschickt: ein Konto mit Haushalt, die zweite Anfrage bekommt 'E-Mail existiert'", async () => {
    const { succeeded, errors } = await settleAll([registerAction(registration()), registerAction(registration())]);

    expect(succeeded).toBe(1);
    expect(errors).toEqual(["REDIRECT:/register?error=exists"]);
    const users = await prisma.user.findMany({ where: { email: EMAIL }, include: { householdMembership: true } });
    expect(users).toHaveLength(1);
    expect(users[0].householdMembership).toMatchObject({ role: "OWNER" });
    expect(await prisma.household.count()).toBe(1);
  });

  it("scheitert die Haushaltsanlage, bleibt kein Konto ohne Haushalt zurück", async () => {
    // Echter Datenbankfehler mitten in der Registrierung, nur in dieser Testdatenbank.
    await prisma.$executeRawUnsafe(`CREATE TRIGGER r4c_fail_household_insert BEFORE INSERT ON "Household" BEGIN SELECT RAISE(ABORT, 'R4C injected failure'); END;`);
    try {
      await expect(registerAction(registration())).rejects.toThrow();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r4c_fail_household_insert`);
    }

    expect(await prisma.user.count({ where: { email: EMAIL } })).toBe(0);
    expect(await prisma.household.count()).toBe(0);
  });
});

describe("Eigenen Haushalt anlegen, POST /api/household (R4-05)", () => {
  it("zwei gleichzeitige Anfragen: ein Haushalt, die zweite Anfrage bekommt 409; kein verwaister Haushalt", async () => {
    const { user } = await createPerson("A");
    session.userId = user.id;
    const request = () =>
      new Request("http://localhost/api/household", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "WG" }) });

    const responses = await Promise.all([householdRoute.POST(request()), householdRoute.POST(request())]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(await prisma.household.count()).toBe(1);
    expect(await prisma.householdMember.count({ where: { userId: user.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R4-08: Altaccount einrichten (Claim eines Users ohne Passwort)
// ---------------------------------------------------------------------------

describe("Altaccount einrichten (R4-08)", () => {
  it("zwei gleichzeitige Einrichtungen: nur die erste gilt, die zweite überschreibt weder E-Mail noch Passwort", async () => {
    const legacy = await prisma.user.create({ data: { name: "Altprofil" } });
    const claims = [
      { email: "erste@test.invalid", password: "passwort-eins" },
      { email: "zweite@test.invalid", password: "passwort-zwei" },
    ];

    const { succeeded, errors } = await settleAll(claims.map((claim) => setupAccountAction(form(claim))));

    // Wie nacheinander abgeschickt: Der Account ist schon eingerichtet, also nichts mehr zu übernehmen.
    expect(succeeded).toBe(1);
    expect(errors).toEqual(["REDIRECT:/register"]);
    expect(signIn).toHaveBeenCalledOnce();
    const winner = claims.find((claim) => claim.email === signIn.mock.calls[0][1].email)!;
    const account = await prisma.user.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(account.email).toBe(winner.email);
    expect(await bcrypt.compare(winner.password, account.passwordHash!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R4-13: Einladungen (HouseholdMember.userId und User.email sind unique)
// ---------------------------------------------------------------------------

describe("Einladung (R4-13)", () => {
  async function householdWithInviteFor(email: string) {
    const owner = await createPerson("Owner");
    const household = await createHousehold(owner.user.id);
    const invite = await createInvite(household.id, { email, role: "MEMBER" });
    if (!invite.ok) throw new Error(`Einladung nicht angelegt: ${invite.error}`);
    return { household, token: invite.token };
  }

  it("als angemeldeter Nutzer doppelt angenommen: eine Annahme gelingt, die zweite meldet 'bereits im Haushalt'", async () => {
    const { household, token } = await householdWithInviteFor(EMAIL);
    const invitee = await prisma.user.create({ data: { name: "Gast", email: EMAIL } });

    const results = await Promise.all([acceptInvite(token, invitee.id, EMAIL), acceptInvite(token, invitee.id, EMAIL)]);

    expect(results).toContainEqual({ ok: true, householdId: household.id, role: "MEMBER" });
    expect(results).toContainEqual({ ok: false, error: "ALREADY_IN_HOUSEHOLD" });
    expect(await prisma.householdMember.count({ where: { userId: invitee.id } })).toBe(1);
  });

  it("Registrierung über den Einladungslink doppelt abgeschickt: ein Konto im Haushalt, die zweite Anfrage bekommt 'E-Mail existiert'", async () => {
    const { household, token } = await householdWithInviteFor(EMAIL);
    const registration = () => form({ token, name: "Gast", email: EMAIL, password: "sicheres-passwort" });

    const { succeeded, errors } = await settleAll([registerViaInviteAction(registration()), registerViaInviteAction(registration())]);

    expect(succeeded).toBe(1);
    expect(errors).toEqual([`REDIRECT:/invite/${token}?error=exists`]);
    const users = await prisma.user.findMany({ where: { email: EMAIL }, include: { householdMembership: true } });
    expect(users).toHaveLength(1);
    expect(users[0].householdMembership).toMatchObject({ householdId: household.id, role: "MEMBER" });
  });
});
