import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, fromDbDate, toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Planungshorizont für persönliche Tagespläne (R5F-13) gegen eine isolierte SQLite-Datenbank:
 * automatisch erzeugt und neu geplant wird nur von heute bis Sonntag der nächsten Kalenderwoche.
 * Gespeicherte Pläne dahinter bleiben unverändert und lesbar. "Heute" ist fest vorgegeben (Service)
 * bzw. über eine feste Serveruhr (Route), nie die echte Uhr. prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f13-horizon-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, getOrGenerateWeekPlan, hasStoredEditableDays, regenerateEditableDays } = await import("@/lib/generateMealPlan");
const planRoute = await import("@/app/api/plan/route");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

/** Montag, 21.09.2026: laufende Woche bis 27.09., nächste Woche 28.09. bis 04.10. (Horizont). */
const TODAY: CalendarDate = "2026-09-21";
const YESTERDAY: CalendarDate = "2026-09-20";
const LAST_OF_THIS_WEEK: CalendarDate = "2026-09-27";
const FIRST_OF_NEXT_WEEK: CalendarDate = "2026-09-28";
const LAST_OF_NEXT_WEEK: CalendarDate = "2026-10-04";
const FIRST_BEYOND: CalendarDate = "2026-10-05";
/** Mittwoch in zwei Wochen - hinter dem Horizont. */
const WEDNESDAY_IN_TWO_WEEKS: CalendarDate = "2026-10-07";
const FAR_AWAY: CalendarDate = "2099-06-15";
/** Serveruhr: Montag, 21.09.2026, 10:00 Uhr in Berlin. */
const SERVER_NOW = new Date("2026-09-21T10:00:00+02:00");

const OUTSIDE_HORIZON = { error: "Dieser Tag liegt außerhalb des aktuellen Planungshorizonts." };

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
  vi.useRealTimers();
});

async function personWithRecipe() {
  const person = await createPerson("A");
  const recipe = await createRecipe("Reis-Bowl");
  return { ...person, profileId: person.profile.id, recipe };
}

/** Ein Tag, wie ihn ein Request an genau diesem Tag erzeugt hätte (damals lag er im Horizont). */
async function planAsItHappened(profileId: string, day: CalendarDate) {
  const plan = await getOrGenerateDayPlan(profileId, day, day);
  if (!plan) throw new Error(`${day} hätte an diesem Tag erzeugt werden müssen`);
  return plan;
}

function storedDay(profileId: string, day: CalendarDate) {
  return prisma.mealPlanDay.findUnique({ where: { profileId_date: { profileId, date: toDbDate(day) } }, include: { items: true } });
}

async function storedDates(profileId: string): Promise<CalendarDate[]> {
  const days = await prisma.mealPlanDay.findMany({ where: { profileId }, select: { date: true }, orderBy: { date: "asc" } });
  return days.map((d) => fromDbDate(d.date));
}

async function rowCounts() {
  return { days: await prisma.mealPlanDay.count(), items: await prisma.mealPlanItem.count() };
}

describe("getOrGenerateDayPlan: Erzeugung nur im Planungshorizont (R5F-13)", () => {
  it("gestern ohne Plan bleibt null (R5E)", async () => {
    const { profileId } = await personWithRecipe();

    expect(await getOrGenerateDayPlan(profileId, YESTERDAY, TODAY)).toBeNull();
    expect(await storedDates(profileId)).toEqual([]);
  });

  it.each([
    ["heute", TODAY],
    ["letzter Tag der laufenden Woche", LAST_OF_THIS_WEEK],
    ["erster Tag der nächsten Woche", FIRST_OF_NEXT_WEEK],
    ["letzter Tag der nächsten Woche", LAST_OF_NEXT_WEEK],
  ] as const)("%s (%s) wird erzeugt", async (_label, day) => {
    const { profileId } = await personWithRecipe();

    const plan = await getOrGenerateDayPlan(profileId, day, TODAY);

    expect(plan?.items.length).toBeGreaterThan(0);
    expect(await storedDates(profileId)).toEqual([day]);
  });

  it.each([
    ["erster Tag der übernächsten Woche", FIRST_BEYOND],
    ["weit entfernt", FAR_AWAY],
  ] as const)("%s (%s) wird nicht erzeugt: null, nichts gespeichert", async (_label, day) => {
    const { profileId } = await personWithRecipe();

    expect(await getOrGenerateDayPlan(profileId, day, TODAY)).toBeNull();
    expect(await rowCounts()).toEqual({ days: 0, items: 0 });
  });

  it("ein gespeicherter Plan hinter dem Horizont wird unverändert zurückgegeben", async () => {
    const { profileId } = await personWithRecipe();
    await planAsItHappened(profileId, WEDNESDAY_IN_TWO_WEEKS);
    const before = await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS);

    const plan = await getOrGenerateDayPlan(profileId, WEDNESDAY_IN_TWO_WEEKS, TODAY);

    expect(plan?.id).toBe(before!.id);
    expect(await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS)).toEqual(before);
  });
});

describe("getOrGenerateWeekPlan im Planungshorizont (R5F-13)", () => {
  it("die laufende Woche wird ab heute vollständig erzeugt", async () => {
    const { profileId } = await personWithRecipe();

    const week = await getOrGenerateWeekPlan(profileId, TODAY, TODAY);

    expect(week.every((day) => day !== null)).toBe(true);
    expect(await storedDates(profileId)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(TODAY, i)));
  });

  it("die nächste Woche wird vollständig erzeugt", async () => {
    const { profileId } = await personWithRecipe();

    const week = await getOrGenerateWeekPlan(profileId, FIRST_OF_NEXT_WEEK, TODAY);

    expect(week.every((day) => day !== null)).toBe(true);
    expect(await storedDates(profileId)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(FIRST_OF_NEXT_WEEK, i)));
  });

  it("die übernächste Woche wird nicht erzeugt; ein gespeicherter Tag darin kommt unverändert mit", async () => {
    const { profileId } = await personWithRecipe();
    await planAsItHappened(profileId, WEDNESDAY_IN_TWO_WEEKS);
    const before = await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS);

    const week = await getOrGenerateWeekPlan(profileId, FIRST_BEYOND, TODAY);

    expect(week.map((day) => (day ? fromDbDate(day.date) : null))).toEqual([null, null, WEDNESDAY_IN_TWO_WEEKS, null, null, null, null]);
    expect(await storedDates(profileId)).toEqual([WEDNESDAY_IN_TWO_WEEKS]);
    expect(await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS)).toEqual(before);
  });
});

describe("Neuplanung im Planungshorizont (R5F-13)", () => {
  /** Gespeicherte Tage mit dem Erdnuss-Rezept; danach eine neue Erdnuss-Allergie und ein Alternativrezept. */
  async function outdatedPlans(days: CalendarDate[]) {
    const { profile } = await createPerson("A");
    await prisma.recipe.create({
      data: {
        name: "Erdnuss-Bowl",
        description: "",
        kcal: 450,
        proteinG: 25,
        carbsG: 50,
        fatG: 12,
        prepTimeMin: 15,
        mealSlots: JSON.stringify(["LUNCH"]),
        dietTypes: JSON.stringify(["OMNIVORE"]),
        allergens: "[]",
        ingredients: JSON.stringify(["100 g Erdnüsse"]),
        instructions: JSON.stringify(["Anrichten."]),
      },
    });
    for (const day of days) await planAsItHappened(profile.id, day);
    const rice = await createRecipe("Reis-Bowl");
    await prisma.profileTag.create({ data: { label: "Erdnüsse", allergyOfProfileId: profile.id } });
    return { profileId: profile.id, rice };
  }

  it("plant heute bis Ende der nächsten Woche neu; gestern und Tage dahinter bleiben samt Einträgen unverändert", async () => {
    const { profileId, rice } = await outdatedPlans([YESTERDAY, TODAY, LAST_OF_NEXT_WEEK, FIRST_BEYOND, WEDNESDAY_IN_TWO_WEEKS]);
    const unchanged = async () => Promise.all([YESTERDAY, FIRST_BEYOND, WEDNESDAY_IN_TWO_WEEKS].map((day) => storedDay(profileId, day)));
    const before = await unchanged();

    const result = await regenerateEditableDays(profileId, TODAY);

    expect(result.regeneratedDays).toEqual([TODAY, LAST_OF_NEXT_WEEK]);
    for (const day of [TODAY, LAST_OF_NEXT_WEEK]) {
      expect((await storedDay(profileId, day))!.items.map((item) => item.recipeId)).toEqual([rice.id]);
    }
    expect(await unchanged()).toEqual(before);
    expect(await storedDates(profileId)).toEqual([YESTERDAY, TODAY, LAST_OF_NEXT_WEEK, FIRST_BEYOND, WEDNESDAY_IN_TWO_WEEKS]);
  });

  it("gibt es nur gespeicherte Tage hinter dem Horizont, wird nichts neu geplant und nicht nach einer Anpassung gefragt", async () => {
    const { profileId } = await outdatedPlans([WEDNESDAY_IN_TWO_WEEKS]);
    const before = await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS);

    expect(await hasStoredEditableDays(profileId, TODAY)).toBe(false);
    expect(await regenerateEditableDays(profileId, TODAY)).toEqual({ regeneratedDays: [] });
    expect(await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS)).toEqual(before);
  });

  it("gespeicherte Tage im Horizont zählen weiter als bearbeitbar", async () => {
    const { profileId } = await outdatedPlans([LAST_OF_NEXT_WEEK]);

    expect(await hasStoredEditableDays(profileId, TODAY)).toBe(true);
  });
});

describe("GET /api/plan?date= und der Planungshorizont (R5F-13)", () => {
  async function signedIn() {
    const person = await personWithRecipe();
    session.userId = person.user.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW);
    return person;
  }

  function getPlan(date?: string) {
    return planRoute.GET(new Request(`http://localhost/api/plan${date ? `?date=${date}` : ""}`));
  }

  it("ohne Anmeldung weiterhin 401, auch für ein Datum hinter dem Horizont", async () => {
    expect((await getPlan(FAR_AWAY)).status).toBe(401);
  });

  it("ein ungültiges Datum bleibt 400 mit der bisherigen Meldung", async () => {
    await signedIn();

    const res = await getPlan("2026-02-30");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." });
  });

  it("gestern ohne Plan: wie bisher 200 mit plan: null", async () => {
    await signedIn();

    const res = await getPlan(YESTERDAY);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: null });
  });

  it.each([
    ["heute (ohne Datum)", undefined],
    ["letzter Tag der nächsten Woche", LAST_OF_NEXT_WEEK],
  ] as const)("%s wird erzeugt (200)", async (_label, date) => {
    const { profileId } = await signedIn();

    const res = await getPlan(date);

    expect(res.status).toBe(200);
    expect((await res.json()).plan.items.length).toBeGreaterThan(0);
    expect(await storedDates(profileId)).toEqual([date ?? TODAY]);
  });

  it.each([
    ["erster Tag der übernächsten Woche", FIRST_BEYOND],
    ["weit entfernt", FAR_AWAY],
  ] as const)("%s ohne gespeicherten Plan: 400, nichts wird geschrieben", async (_label, date) => {
    await signedIn();

    const res = await getPlan(date);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(OUTSIDE_HORIZON);
    expect(await rowCounts()).toEqual({ days: 0, items: 0 });
  });

  it("ein gespeicherter Plan hinter dem Horizont wird unverändert geliefert (200), nicht abgelehnt", async () => {
    const { profileId } = await signedIn();
    await planAsItHappened(profileId, WEDNESDAY_IN_TWO_WEEKS);
    const before = await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS);

    const res = await getPlan(WEDNESDAY_IN_TWO_WEEKS);

    expect(res.status).toBe(200);
    expect((await res.json()).plan.id).toBe(before!.id);
    expect(await storedDay(profileId, WEDNESDAY_IN_TWO_WEEKS)).toEqual(before);
  });
});
