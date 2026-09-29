import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fromDbDate, startOfWeek, todayForUser, toDbDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * F-10 gegen eine isolierte SQLite-Datenbank: Tagesplan, Log und Woche gehören zum Kalendertag des
 * Nutzers. Gespeichert wird immer die UTC-Mitternacht dieses Tages - egal, in welcher Zeitzone der
 * Server läuft (simuliert über process.env.TZ). prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-f10-days-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan } = await import("@/lib/generateMealPlan");
const { getRemainingDailyTargets } = await import("@/lib/agents/remainingTargets");
const logRoute = await import("@/app/api/log/route");
const planRoute = await import("@/app/api/plan/route");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

/** 00:30 Uhr am 26.09. in Deutschland - in UTC ist es noch der 25.09., 22:30. */
const HALF_PAST_MIDNIGHT = new Date("2026-09-26T00:30:00+02:00");
const originalTimeZone = process.env.TZ;

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
  session.userId = null;
});

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe("Tagesplan: Kalendertag des Nutzers, unabhängig vom Server (F-10)", () => {
  it("speichert den Plan unter UTC-Mitternacht des Nutzertags und findet ihn in jeder Serverzeitzone wieder", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");

    const planIds: string[] = [];
    for (const serverTimeZone of ["America/New_York", "Asia/Tokyo", "UTC", "Europe/Berlin"]) {
      process.env.TZ = serverTimeZone;
      const today = todayForUser(HALF_PAST_MIDNIGHT);
      const plan = await getOrGenerateDayPlan(profile.id, today, today);
      if (!plan) throw new Error("Der heutige Tag muss einen Plan haben.");
      planIds.push(plan.id);
      expect(plan.date.toISOString()).toBe("2026-09-26T00:00:00.000Z");
    }

    expect(new Set(planIds).size).toBe(1);
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
  });

  it("der Wochenplan beginnt am Montag Nutzerzeit, auch wenn es in UTC noch Sonntag ist", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    process.env.TZ = "America/Los_Angeles";

    const mondayEarly = new Date("2026-09-28T00:30:00+02:00"); // UTC: Sonntag, 22:30
    const today = todayForUser(mondayEarly);
    const week = await getOrGenerateWeekPlan(profile.id, startOfWeek(today), today);

    expect(week.map((day) => day?.date.toISOString().slice(0, 10))).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });
});

describe("Bearbeitungsgrenze nach deutschem Kalendertag (R5E)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("um 00:30 Uhr in Berlin ist der Vortag historisch, obwohl er in UTC noch läuft - in jeder Serverzeitzone", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    const today = todayForUser(HALF_PAST_MIDNIGHT); // 26.09., in UTC noch der 25.09.

    for (const serverTimeZone of ["America/Los_Angeles", "UTC", "Asia/Tokyo", "Europe/Berlin"]) {
      process.env.TZ = serverTimeZone;
      expect(await getOrGenerateDayPlan(profile.id, "2026-09-25", today)).toBeNull();
    }
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(0);

    const plan = await getOrGenerateDayPlan(profile.id, today, today);
    expect(plan && fromDbDate(plan.date)).toBe("2026-09-26");
  });

  it("GET /api/plan erzeugt einen fehlenden vergangenen Tag nicht, liefert plan: null und erzeugt heute weiterhin", async () => {
    const { user, profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    session.userId = user.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HALF_PAST_MIDNIGHT);

    const past = await planRoute.GET(new Request("http://localhost/api/plan?date=2026-09-25"));
    expect(past.status).toBe(200);
    expect(await past.json()).toEqual({ plan: null });
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(0);

    const current = await planRoute.GET(new Request("http://localhost/api/plan"));
    const { plan } = await current.json();
    expect(plan.date).toBe("2026-09-26T00:00:00.000Z");
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
  });

  it("GET /api/plan liefert einen gespeicherten vergangenen Tag unverändert", async () => {
    const { user, profile } = await createPerson("A");
    await createRecipe("Reis-Bowl");
    session.userId = user.id;
    const stored = await getOrGenerateDayPlan(profile.id, "2026-09-25", "2026-09-25"); // am 25.09. selbst erzeugt
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(HALF_PAST_MIDNIGHT);

    const res = await planRoute.GET(new Request("http://localhost/api/plan?date=2026-09-25"));
    const { plan } = await res.json();

    expect(plan.id).toBe(stored!.id);
    expect(plan.items.map((item: { id: string }) => item.id)).toEqual(stored!.items.map((item) => item.id));
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
  });
});

describe("Log: ein Eintrag gehört zum Kalendertag des Nutzers (F-10)", () => {
  function logRequest(date: string) {
    return new Request("http://localhost/api/log", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ date, slot: "BREAKFAST", customName: "Müsli", kcal: 400, proteinG: 20, carbsG: 50, fatG: 10 }),
    });
  }

  it("ein um 00:30 Uhr geloggter Eintrag zählt zum neuen Tag, nicht zum Vortag", async () => {
    const { user, profile } = await createPerson("A");
    session.userId = user.id;
    process.env.TZ = "UTC";

    const res = await logRoute.POST(logRequest(todayForUser(HALF_PAST_MIDNIGHT)));
    expect(res.status).toBe(200);
    expect((await prisma.logEntry.findFirstOrThrow({ where: { profileId: profile.id } })).date).toEqual(toDbDate("2026-09-26"));

    const fullTargets = await getRemainingDailyTargets(profile.id, new Date("2026-09-25T23:30:00+02:00"));
    const afterBreakfast = await getRemainingDailyTargets(profile.id, new Date("2026-09-26T09:00:00+02:00"));
    expect(fullTargets.kcal - afterBreakfast.kcal).toBe(400);
  });

  it("ein vergangener Tag bleibt loggbar, unabhängig davon, ob es für ihn einen Plan gibt (R5E)", async () => {
    const { user, profile } = await createPerson("A");
    session.userId = user.id;

    const res = await logRoute.POST(logRequest("2026-09-20"));

    expect(res.status).toBe(200);
    expect((await prisma.logEntry.findFirstOrThrow({ where: { profileId: profile.id } })).date).toEqual(toDbDate("2026-09-20"));
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(0);
  });

  it("lehnt einen Zeitpunkt statt eines Kalendertags ab", async () => {
    const { user } = await createPerson("A");
    session.userId = user.id;

    const res = await logRoute.POST(logRequest(HALF_PAST_MIDNIGHT.toISOString()));

    expect(res.status).toBe(400);
    expect(await prisma.logEntry.count()).toBe(0);
  });
});
