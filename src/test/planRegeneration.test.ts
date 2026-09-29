import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fromDbDate, toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Ausdrückliche Neuplanung der bearbeitbaren Tagespläne (R5E-2) gegen eine isolierte SQLite-Datenbank:
 * echte Transaktion, Unique-Index [profileId, date], Cascade auf die Einträge, Log-Einträge daneben.
 * "Heute" ist fest vorgegeben (Service) bzw. über eine feste Serveruhr (Route), nie die echte Uhr.
 * prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5e2-regenerate-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { getOrGenerateDayPlan, regenerateEditableDays } = await import("@/lib/generateMealPlan");
const regenerateRoute = await import("@/app/api/plan/regenerate/route");
const { createPerson, createRecipe, clearFixtureData } = databaseFixtures(prisma);

/** Donnerstag. Gestern und früher sind historisch, heute und später bearbeitbar. */
const TODAY: CalendarDate = "2026-09-24";
const YESTERDAY: CalendarDate = "2026-09-23";
const OLDER: CalendarDate = "2026-09-10";
const TOMORROW: CalendarDate = "2026-09-25";
const NEXT_WEEK: CalendarDate = "2026-10-01";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r5e_fail_day_insert`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r5e_fail_item_insert`);
  await clearFixtureData();
  session.userId = null;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Katalogrezept fürs Mittagessen mit Erdnüssen (ohne Allergen-Tag, erkannt über die Zutat). */
function createPeanutRecipe() {
  return prisma.recipe.create({
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
}

/** Legt jeden Tag so an, wie ihn ein Request an genau diesem Tag erzeugt hätte (damals war er heute). */
async function planDaysAsTheyHappened(profileId: string, days: CalendarDate[]) {
  for (const day of days) await getOrGenerateDayPlan(profileId, day, day);
}

function storedDay(profileId: string, day: CalendarDate) {
  return prisma.mealPlanDay.findUnique({
    where: { profileId_date: { profileId, date: toDbDate(day) } },
    include: { items: { orderBy: { time: "asc" } } },
  });
}

async function storedDates(profileId: string): Promise<CalendarDate[]> {
  const days = await prisma.mealPlanDay.findMany({ where: { profileId }, select: { date: true }, orderBy: { date: "asc" } });
  return days.map((d) => fromDbDate(d.date));
}

async function recipeIdsOn(profileId: string, day: CalendarDate): Promise<string[]> {
  return (await storedDay(profileId, day))?.items.map((item) => item.recipeId) ?? [];
}

/** Profil mit bisherigen Tagesplänen (alle mit dem Erdnuss-Rezept), danach eine neue Erdnuss-Allergie und ein Alternativrezept. */
async function personWithOutdatedPlans(days: CalendarDate[]) {
  const person = await createPerson("A");
  const peanut = await createPeanutRecipe();
  await planDaysAsTheyHappened(person.profile.id, days);
  const rice = await createRecipe("Reis-Bowl");
  await prisma.profileTag.create({ data: { label: "Erdnüsse", allergyOfProfileId: person.profile.id } });
  return { ...person, peanut, rice };
}

describe("regenerateEditableDays: historische Tage (R5E-2)", () => {
  it("lässt gestern und ältere Tage samt Einträgen unverändert und löscht keinen davon", async () => {
    const { profile, peanut } = await personWithOutdatedPlans([OLDER, YESTERDAY, TODAY]);
    const yesterdayBefore = await storedDay(profile.id, YESTERDAY);
    const olderBefore = await storedDay(profile.id, OLDER);
    expect(yesterdayBefore?.items.map((item) => item.recipeId)).toEqual([peanut.id]);

    await regenerateEditableDays(profile.id, TODAY);

    expect(await storedDay(profile.id, YESTERDAY)).toEqual(yesterdayBefore);
    expect(await storedDay(profile.id, OLDER)).toEqual(olderBefore);
  });

  it("legt fehlende historische Tage nicht an", async () => {
    const { profile } = await personWithOutdatedPlans([OLDER, TODAY]);

    await regenerateEditableDays(profile.id, TODAY);

    expect(await storedDates(profile.id)).toEqual([OLDER, TODAY]);
    expect(await getOrGenerateDayPlan(profile.id, YESTERDAY, TODAY)).toBeNull();
  });
});

describe("regenerateEditableDays: heute und Zukunft (R5E-2)", () => {
  it("plant heute mit dem aktuellen Profil neu: die neue Allergie greift, die alten Einträge sind genau einmal ersetzt", async () => {
    const { profile, peanut, rice } = await personWithOutdatedPlans([TODAY]);
    const before = await storedDay(profile.id, TODAY);
    expect(before?.items.map((item) => item.recipeId)).toEqual([peanut.id]);

    const result = await regenerateEditableDays(profile.id, TODAY);

    const after = await storedDay(profile.id, TODAY);
    expect(result.regeneratedDays).toEqual([TODAY]);
    expect(after?.id).not.toBe(before?.id);
    expect(after?.items.map((item) => item.recipeId)).toEqual([rice.id]);
    expect(await prisma.mealPlanDay.count({ where: { profileId: profile.id } })).toBe(1);
    expect(await prisma.mealPlanItem.count({ where: { id: { in: before!.items.map((item) => item.id) } } })).toBe(0);
    expect(await prisma.mealPlanItem.count({ where: { mealPlanDayId: after!.id } })).toBe(after!.items.length);
  });

  it("plant alle gespeicherten künftigen Tage neu, ohne Duplikate", async () => {
    const { profile, rice } = await personWithOutdatedPlans([TODAY, TOMORROW, NEXT_WEEK]);

    const result = await regenerateEditableDays(profile.id, TODAY);

    expect(result.regeneratedDays).toEqual([TODAY, TOMORROW, NEXT_WEEK]);
    expect(await storedDates(profile.id)).toEqual([TODAY, TOMORROW, NEXT_WEEK]);
    for (const day of [TODAY, TOMORROW, NEXT_WEEK]) expect(await recipeIdsOn(profile.id, day)).toEqual([rice.id]);
  });

  it("legt keine zusätzlichen Tage an: fehlende bearbeitbare Tage entstehen wie bisher erst beim Lesen", async () => {
    const { profile, rice } = await personWithOutdatedPlans([YESTERDAY, TODAY, NEXT_WEEK]);

    const result = await regenerateEditableDays(profile.id, TODAY);

    expect(result.regeneratedDays).toEqual([TODAY, NEXT_WEEK]);
    expect(await storedDates(profile.id)).toEqual([YESTERDAY, TODAY, NEXT_WEEK]);

    // Der normale Weg (Dashboard, /plan) erzeugt den fehlenden Tag weiterhin - schon mit dem aktuellen Profil.
    const tomorrow = await getOrGenerateDayPlan(profile.id, TOMORROW, TODAY);
    expect(tomorrow?.items.map((item) => item.recipeId)).toEqual([rice.id]);
  });

  it("ohne gespeicherte bearbeitbare Tage passiert nichts", async () => {
    const { profile } = await personWithOutdatedPlans([YESTERDAY]);
    const before = await storedDay(profile.id, YESTERDAY);

    expect(await regenerateEditableDays(profile.id, TODAY)).toEqual({ regeneratedDays: [] });
    expect(await storedDates(profile.id)).toEqual([YESTERDAY]);
    expect(await storedDay(profile.id, YESTERDAY)).toEqual(before);
  });

  it("berücksichtigt für die Abwechslung die bleibenden historischen Tage derselben Woche", async () => {
    const { profile } = await createPerson("A");
    await createRecipe("Bowl A");
    await createRecipe("Bowl B");
    await planDaysAsTheyHappened(profile.id, [YESTERDAY, TODAY]);
    const [yesterdayRecipe] = await recipeIdsOn(profile.id, YESTERDAY);

    await regenerateEditableDays(profile.id, TODAY);

    expect(await recipeIdsOn(profile.id, TODAY)).not.toEqual([yesterdayRecipe]);
  });
});

describe("regenerateEditableDays: tatsächlicher Verzehr (R5E-2)", () => {
  it("lässt Log-Einträge von gestern und heute samt Nährwerten unverändert", async () => {
    const { profile, peanut } = await personWithOutdatedPlans([YESTERDAY, TODAY]);
    for (const day of [YESTERDAY, TODAY]) {
      await prisma.logEntry.create({
        data: { profileId: profile.id, date: toDbDate(day), slot: "LUNCH", recipeId: peanut.id, customName: "Erdnuss-Bowl", kcal: 512, proteinG: 27.5, carbsG: 51, fatG: 14.2 },
      });
    }
    const logsBefore = await prisma.logEntry.findMany({ where: { profileId: profile.id }, orderBy: { date: "asc" } });

    await regenerateEditableDays(profile.id, TODAY);

    expect(await prisma.logEntry.findMany({ where: { profileId: profile.id }, orderBy: { date: "asc" } })).toEqual(logsBefore);
  });
});

describe("regenerateEditableDays: Konsistenz (R5E-2)", () => {
  it("scheitert ein Schritt, bleiben alle alten Tage erhalten - nichts ist halb neu geplant", async () => {
    const { profile, peanut } = await personWithOutdatedPlans([YESTERDAY, TODAY, TOMORROW, NEXT_WEEK]);
    const before = await prisma.mealPlanDay.findMany({ where: { profileId: profile.id }, include: { items: true }, orderBy: { date: "asc" } });
    // Bricht in DIESER Testdatenbank das Anlegen des letzten neu geplanten Tages ab - ein echter DB-Fehler mitten in der Transaktion.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5e_fail_day_insert BEFORE INSERT ON "MealPlanDay" WHEN NEW."date" = ${toDbDate(NEXT_WEEK).getTime()} BEGIN SELECT RAISE(ABORT, 'R5E injected failure'); END;`,
    );

    await expect(regenerateEditableDays(profile.id, TODAY)).rejects.toThrow();

    expect(await prisma.mealPlanDay.findMany({ where: { profileId: profile.id }, include: { items: true }, orderBy: { date: "asc" } })).toEqual(before);
    expect(await recipeIdsOn(profile.id, TODAY)).toEqual([peanut.id]);
  });
});

describe("POST /api/plan/regenerate (R5E-2)", () => {
  /** 00:30 Uhr am 24.09. in Berlin - in UTC ist es noch der 23.09., 22:30. */
  const SERVER_NOW = new Date("2026-09-24T00:30:00+02:00");

  it("lehnt eine nicht angemeldete Anfrage mit 401 ab und ändert nichts", async () => {
    const { profile } = await personWithOutdatedPlans([TODAY]);
    const before = await storedDay(profile.id, TODAY);

    const res = await regenerateRoute.POST();

    expect(res.status).toBe(401);
    expect(await storedDay(profile.id, TODAY)).toEqual(before);
  });

  it("liefert 404 ohne Profil", async () => {
    const { user } = await createPerson("B");
    await prisma.profile.delete({ where: { userId: user.id } });
    session.userId = user.id;

    expect((await regenerateRoute.POST()).status).toBe(404);
  });

  it("plant für den angemeldeten Nutzer neu; heute bestimmt die Serveruhr nach deutschem Kalendertag", async () => {
    const { user, profile, rice } = await personWithOutdatedPlans([YESTERDAY, TODAY, TOMORROW]);
    const yesterdayBefore = await storedDay(profile.id, YESTERDAY);
    session.userId = user.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW);

    const res = await regenerateRoute.POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ today: TODAY, regeneratedDays: [TODAY, TOMORROW] });
    // In UTC wäre der 23.09. noch "heute" - nach deutschem Kalendertag ist er historisch und bleibt unverändert.
    expect(await storedDay(profile.id, YESTERDAY)).toEqual(yesterdayBefore);
    expect(await recipeIdsOn(profile.id, TODAY)).toEqual([rice.id]);
  });

  it("nimmt keine Eingaben an: weder ein Datum noch ein Zeitraum lässt sich vom Client vorgeben", () => {
    // Der Handler hat keinen Parameter und liest weder Body noch Query; ein historischer Tag ist darüber nicht erreichbar.
    expect(regenerateRoute.POST).toHaveLength(0);
  });
});

describe("regenerateEditableDays: heute bereits geloggte Slots bleiben (R5E-Final)", () => {
  const SLOTS = ["BREAKFAST", "LUNCH", "DINNER"] as const;
  type PlannedSlot = (typeof SLOTS)[number];

  function createSlotRecipe(name: string, slot: PlannedSlot, ingredient: string) {
    return prisma.recipe.create({
      data: {
        name,
        description: "",
        kcal: 500,
        proteinG: 30,
        carbsG: 55,
        fatG: 15,
        prepTimeMin: 15,
        mealSlots: JSON.stringify([slot]),
        dietTypes: JSON.stringify(["OMNIVORE"]),
        allergens: "[]",
        ingredients: JSON.stringify([ingredient]),
        instructions: JSON.stringify(["Zubereiten."]),
      },
    });
  }

  /**
   * Gestern, heute und morgen mit Erdnuss-Rezepten für Frühstück, Mittag und Abend geplant; danach eine
   * neue Erdnuss-Allergie und Reis-Alternativen je Slot. `loggedSlots` sind heute schon abgehakt.
   */
  async function todayPartlyLogged(loggedSlots: PlannedSlot[]) {
    const { profile } = await createPerson("A");
    for (const slot of SLOTS) await createSlotRecipe(`Erdnuss-${slot}`, slot, "100 g Erdnüsse");
    await planDaysAsTheyHappened(profile.id, [YESTERDAY, TODAY, TOMORROW]);

    const rice = new Map<string, string>();
    for (const slot of SLOTS) rice.set(slot, (await createSlotRecipe(`Reis-${slot}`, slot, "150 g Reis")).id);
    await prisma.profileTag.create({ data: { label: "Erdnüsse", allergyOfProfileId: profile.id } });

    for (const slot of loggedSlots) {
      const [item] = (await storedDay(profile.id, TODAY))!.items.filter((i) => i.slot === slot);
      await prisma.logEntry.create({
        data: { profileId: profile.id, date: toDbDate(TODAY), slot, recipeId: item.recipeId, customName: "abgehakt", kcal: 612, proteinG: 33.3, carbsG: 61, fatG: 17.5 },
      });
    }
    return { profileId: profile.id, rice };
  }

  function itemInSlot(day: Awaited<ReturnType<typeof storedDay>>, slot: string) {
    return day!.items.find((item) => item.slot === slot);
  }

  it.each([
    ["Frühstück", ["BREAKFAST"]],
    ["Mittagessen", ["LUNCH"]],
    ["mehrere Slots", ["BREAKFAST", "LUNCH"]],
  ] as const)("behält geloggte Slots (%s) samt Mahlzeit und Snapshot, plant die übrigen Slots neu", async (_label, loggedSlots) => {
    const { profileId, rice } = await todayPartlyLogged([...loggedSlots]);
    const before = await storedDay(profileId, TODAY);

    await regenerateEditableDays(profileId, TODAY);

    const after = await storedDay(profileId, TODAY);
    expect(after!.id).toBe(before!.id);
    for (const slot of SLOTS) {
      if ((loggedSlots as readonly string[]).includes(slot)) {
        // Unverändert: dieselbe Zeile mit Rezept, Portion und Snapshot von damals.
        expect(itemInSlot(after, slot)).toEqual(itemInSlot(before, slot));
      } else {
        expect(itemInSlot(after, slot)?.id).not.toBe(itemInSlot(before, slot)?.id);
        expect(itemInSlot(after, slot)).toMatchObject({ recipeId: rice.get(slot), recipeName: `Reis-${slot}` });
      }
    }
    expect(after!.items).toHaveLength(SLOTS.length);
  });

  it("ohne geloggte Slots wird heute wie bisher vollständig neu geplant", async () => {
    const { profileId, rice } = await todayPartlyLogged([]);

    await regenerateEditableDays(profileId, TODAY);

    const after = await storedDay(profileId, TODAY);
    expect(after!.items.map((item) => item.recipeId).sort()).toEqual([...rice.values()].sort());
  });

  it("sind alle Slots geloggt, bleibt der heutige Plan unverändert", async () => {
    const { profileId } = await todayPartlyLogged([...SLOTS]);
    const before = await storedDay(profileId, TODAY);

    await regenerateEditableDays(profileId, TODAY);

    expect((await storedDay(profileId, TODAY))!.items).toEqual(before!.items);
  });

  it("ein heute bisher fehlender, ungeloggter Slot wird normal neu geplant", async () => {
    const { profileId, rice } = await todayPartlyLogged(["BREAKFAST"]);
    const dinner = itemInSlot(await storedDay(profileId, TODAY), "DINNER")!;
    await prisma.mealPlanItem.delete({ where: { id: dinner.id } });

    await regenerateEditableDays(profileId, TODAY);

    expect(itemInSlot(await storedDay(profileId, TODAY), "DINNER")).toMatchObject({ recipeId: rice.get("DINNER") });
  });

  it("künftige Tage werden vollständig neu geplant, gestern bleibt unverändert, Log-Einträge bleiben unverändert", async () => {
    const { profileId, rice } = await todayPartlyLogged(["BREAKFAST", "LUNCH"]);
    const tomorrowBefore = await storedDay(profileId, TOMORROW);
    const yesterdayBefore = await storedDay(profileId, YESTERDAY);
    const logsBefore = await prisma.logEntry.findMany({ where: { profileId }, orderBy: { slot: "asc" } });

    await regenerateEditableDays(profileId, TODAY);

    const tomorrowAfter = await storedDay(profileId, TOMORROW);
    expect(tomorrowAfter!.id).not.toBe(tomorrowBefore!.id);
    expect(tomorrowAfter!.items.map((item) => item.recipeId).sort()).toEqual([...rice.values()].sort());
    expect(await storedDay(profileId, YESTERDAY)).toEqual(yesterdayBefore);
    expect(await prisma.logEntry.findMany({ where: { profileId }, orderBy: { slot: "asc" } })).toEqual(logsBefore);
  });

  it("scheitert ein Schritt, bleiben alle Tage vollständig erhalten - auch die schon gelöschten ungeloggten Slots von heute", async () => {
    const { profileId, rice } = await todayPartlyLogged(["BREAKFAST"]);
    const before = await prisma.mealPlanDay.findMany({ where: { profileId }, include: { items: true }, orderBy: { date: "asc" } });
    // Bricht das Anlegen jeder neuen Reis-Abendmahlzeit ab - auch die im teilweise ersetzten heutigen Tag.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5e_fail_item_insert BEFORE INSERT ON "MealPlanItem" WHEN NEW."recipeId" = '${rice.get("DINNER")}' BEGIN SELECT RAISE(ABORT, 'R5E injected failure'); END;`,
    );

    await expect(regenerateEditableDays(profileId, TODAY)).rejects.toThrow();

    expect(await prisma.mealPlanDay.findMany({ where: { profileId }, include: { items: true }, orderBy: { date: "asc" } })).toEqual(before);
  });
});

