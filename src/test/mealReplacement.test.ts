import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MealSlot } from "@prisma/client";
import { fromDbDate, toDbDate, type CalendarDate } from "@/lib/calendarDate";
import { recipeSnapshotOf } from "@/lib/recipeAsPlanned";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Ersetzen einer einzelnen geplanten Mahlzeit (R5F-7) gegen eine isolierte SQLite-Datenbank: echte
 * Transaktion, Log-Einträge daneben, eingeschleuste DB-Fehler per Trigger. "Heute" ist fest vorgegeben
 * (Service) bzw. über eine feste Serveruhr (Route), nie die echte Uhr. prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f7-replace-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { replacePlannedMeal } = await import("@/lib/generateMealPlan");
const replaceRoute = await import("@/app/api/plan/items/[id]/replace/route");
const { createPerson, clearFixtureData } = databaseFixtures(prisma);

/** Donnerstag. Gestern ist historisch, heute und morgen (dieselbe Woche) bearbeitbar. */
const TODAY: CalendarDate = "2026-09-24";
const YESTERDAY: CalendarDate = "2026-09-23";
const TOMORROW: CalendarDate = "2026-09-25";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r5f7_fail_item_update`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r5f7_log_during_update`);
  await clearFixtureData();
  session.userId = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface RecipeOptions {
  kcal?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  ingredients?: readonly string[];
  dietTypes?: readonly string[];
  isTrending?: boolean;
}

function createSlotRecipe(name: string, slot: MealSlot, options: RecipeOptions = {}) {
  return prisma.recipe.create({
    data: {
      name,
      description: "",
      kcal: options.kcal ?? 500,
      proteinG: options.proteinG ?? 30,
      carbsG: options.carbsG ?? 55,
      fatG: options.fatG ?? 15,
      prepTimeMin: 15,
      isTrending: options.isTrending ?? false,
      mealSlots: JSON.stringify([slot]),
      dietTypes: JSON.stringify(options.dietTypes ?? ["OMNIVORE"]),
      allergens: "[]",
      ingredients: JSON.stringify(options.ingredients ?? ["150 g Reis"]),
      instructions: JSON.stringify(["Zubereiten."]),
    },
  });
}

type StoredRecipe = Awaited<ReturnType<typeof createSlotRecipe>>;
type PlannedMeal = { slot: MealSlot; time: string; recipe: StoredRecipe; portionMultiplier: number };

/** Speichert einen Tagesplan so, wie ihn der Planer angelegt hätte (Einträge samt Rezept-Snapshot). */
function storePlanDay(profileId: string, day: CalendarDate, meals: PlannedMeal[]) {
  return prisma.mealPlanDay.create({
    data: {
      profileId,
      date: toDbDate(day),
      targetKcal: 2000,
      targetProteinG: 110,
      targetCarbsG: 230,
      targetFatG: 70,
      items: {
        create: meals.map(({ slot, time, recipe, portionMultiplier }) => ({
          slot,
          time,
          recipeId: recipe.id,
          portionMultiplier,
          ...recipeSnapshotOf(recipe),
        })),
      },
    },
  });
}

function storedDay(profileId: string, day: CalendarDate) {
  return prisma.mealPlanDay.findUnique({
    where: { profileId_date: { profileId, date: toDbDate(day) } },
    include: { items: { orderBy: { time: "asc" } } },
  });
}

function allDays(profileId: string) {
  return prisma.mealPlanDay.findMany({ where: { profileId }, include: { items: { orderBy: { time: "asc" } } }, orderBy: { date: "asc" } });
}

function allLogs(profileId: string) {
  return prisma.logEntry.findMany({ where: { profileId }, orderBy: [{ date: "asc" }, { slot: "asc" }] });
}

async function itemIn(profileId: string, day: CalendarDate, slot: MealSlot) {
  const item = (await storedDay(profileId, day))?.items.find((i) => i.slot === slot);
  if (!item) throw new Error(`Kein Eintrag ${slot} am ${day}`);
  return item;
}

function logMeal(profileId: string, day: CalendarDate, slot: MealSlot, recipeId: string) {
  return prisma.logEntry.create({
    data: { profileId, date: toDbDate(day), slot, recipeId, customName: "abgehakt", kcal: 612, proteinG: 33.3, carbsG: 61, fatG: 17.5 },
  });
}

/**
 * Gestern, heute und morgen mit Frühstück, Mittag (Linsen-Curry) und Abend geplant. Für das Mittagessen
 * gibt es eine Alternative (Reis-Bowl), sofern `withAlternative`.
 */
async function plannedWeek({ withAlternative = true } = {}) {
  const person = await createPerson("A");
  const breakfast = await createSlotRecipe("Haferbrei", "BREAKFAST", { kcal: 400, proteinG: 15, carbsG: 60, fatG: 10 });
  const lentils = await createSlotRecipe("Linsen-Curry", "LUNCH", { kcal: 600, proteinG: 30, carbsG: 70, fatG: 18, ingredients: ["200 g Linsen"] });
  const dinner = await createSlotRecipe("Ofengemüse", "DINNER", { kcal: 550, proteinG: 25, carbsG: 50, fatG: 22 });
  const rice = withAlternative ? await createSlotRecipe("Reis-Bowl", "LUNCH", { kcal: 450, proteinG: 25, carbsG: 50, fatG: 12 }) : null;
  const meals: PlannedMeal[] = [
    { slot: "BREAKFAST", time: "08:00", recipe: breakfast, portionMultiplier: 1.1 },
    { slot: "LUNCH", time: "13:00", recipe: lentils, portionMultiplier: 1.25 },
    { slot: "DINNER", time: "19:30", recipe: dinner, portionMultiplier: 0.9 },
  ];
  for (const day of [YESTERDAY, TODAY, TOMORROW]) await storePlanDay(person.profile.id, day, meals);
  return { ...person, profileId: person.profile.id, breakfast, lentils, dinner, rice };
}

describe("replacePlannedMeal: Tagesgrenze (R5F-7)", () => {
  it("lehnt eine Mahlzeit von gestern ab und ändert nichts", async () => {
    const { profileId } = await plannedWeek();
    const lunch = await itemIn(profileId, YESTERDAY, "LUNCH");
    const before = await allDays(profileId);

    expect(await replacePlannedMeal(profileId, lunch.id, TODAY)).toEqual({ ok: false, error: "HISTORICAL_DAY" });
    expect(await allDays(profileId)).toEqual(before);
  });

  it("ersetzt eine heutige, noch nicht geloggte Mahlzeit in derselben Zeile", async () => {
    const { profileId, rice } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");

    const result = await replacePlannedMeal(profileId, lunch.id, TODAY);

    expect(result).toMatchObject({ ok: true, item: { id: lunch.id, recipeId: rice!.id, slot: "LUNCH", time: "13:00" } });
    expect(await itemIn(profileId, TODAY, "LUNCH")).toMatchObject({ id: lunch.id, recipeId: rice!.id });
  });

  it("ersetzt eine künftige Mahlzeit", async () => {
    const { profileId, rice } = await plannedWeek();
    const lunch = await itemIn(profileId, TOMORROW, "LUNCH");

    expect(await replacePlannedMeal(profileId, lunch.id, TODAY)).toMatchObject({ ok: true, item: { recipeId: rice!.id } });
  });
});

describe("replacePlannedMeal: geloggte Mahlzeiten (R5F-7)", () => {
  it("lehnt eine heute schon geloggte Mahlzeit ab; Plan und Log-Eintrag bleiben unverändert", async () => {
    const { profileId, lentils } = await plannedWeek();
    await logMeal(profileId, TODAY, "LUNCH", lentils.id);
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    const daysBefore = await allDays(profileId);
    const logsBefore = await allLogs(profileId);

    expect(await replacePlannedMeal(profileId, lunch.id, TODAY)).toEqual({ ok: false, error: "ALREADY_LOGGED" });
    expect(await allDays(profileId)).toEqual(daysBefore);
    expect(await allLogs(profileId)).toEqual(logsBefore);
  });

  it("ein geloggter anderer Slot hindert nicht; alle Log-Einträge bleiben samt Nährwerten unverändert", async () => {
    const { profileId, breakfast, rice } = await plannedWeek();
    await logMeal(profileId, TODAY, "BREAKFAST", breakfast.id);
    await logMeal(profileId, YESTERDAY, "LUNCH", breakfast.id);
    const logsBefore = await allLogs(profileId);

    const result = await replacePlannedMeal(profileId, (await itemIn(profileId, TODAY, "LUNCH")).id, TODAY);

    expect(result).toMatchObject({ ok: true, item: { recipeId: rice!.id } });
    expect(await allLogs(profileId)).toEqual(logsBefore);
  });

  it("Plan und Log gehören über den Slot zusammen: ein geloggter Snack sperrt beide Snacks des Tages", async () => {
    const { profile } = await createPerson("A");
    const profileId = profile.id;
    const snackA = await createSlotRecipe("Joghurt", "SNACK");
    const snackB = await createSlotRecipe("Apfel", "SNACK");
    await createSlotRecipe("Nüsse", "SNACK");
    await storePlanDay(profileId, TODAY, [
      { slot: "SNACK", time: "10:30", recipe: snackA, portionMultiplier: 1 },
      { slot: "SNACK", time: "16:00", recipe: snackB, portionMultiplier: 1 },
    ]);
    await logMeal(profileId, TODAY, "SNACK", snackA.id);
    const before = await allDays(profileId);

    for (const item of before[0].items) {
      expect(await replacePlannedMeal(profileId, item.id, TODAY)).toEqual({ ok: false, error: "ALREADY_LOGGED" });
    }
    expect(await allDays(profileId)).toEqual(before);
  });

  it("wird der Slot während der Ersetzung geloggt, wird zurückgerollt - kein stilles Überschreiben", async () => {
    const { profileId, lentils } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    const before = await allDays(profileId);
    // Ein paralleles Loggen genau zwischen Vorabprüfung und Schreiben: Der Trigger legt den Log-Eintrag
    // innerhalb der Ersetzungs-Transaktion an, die Prüfung danach muss ihn sehen.
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5f7_log_during_update AFTER UPDATE ON "MealPlanItem" BEGIN
         INSERT INTO "LogEntry" ("id", "profileId", "date", "slot", "recipeId", "kcal", "proteinG", "carbsG", "fatG", "createdAt")
         VALUES ('r5f7-race', '${profileId}', ${toDbDate(TODAY).getTime()}, 'LUNCH', '${lentils.id}', 600, 30, 70, 18, ${Date.now()});
       END;`,
    );

    expect(await replacePlannedMeal(profileId, lunch.id, TODAY)).toEqual({ ok: false, error: "ALREADY_LOGGED" });
    expect(await allDays(profileId)).toEqual(before);
  });
});

describe("replacePlannedMeal: nur die gewählte Mahlzeit (R5F-7)", () => {
  it("ändert nur diesen Eintrag: übrige Mahlzeiten, Tagesziele und andere Tage bleiben, kein Tag kommt hinzu", async () => {
    const { profileId } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    const before = await allDays(profileId);

    await replacePlannedMeal(profileId, lunch.id, TODAY);

    const after = await allDays(profileId);
    // Keine Wochen-Neuplanung: dieselben Tage (Mo, Di, Sa, So entstehen nicht), dieselben Zeilen.
    expect(after.map((d) => fromDbDate(d.date))).toEqual([YESTERDAY, TODAY, TOMORROW]);
    expect(after.map(({ items: _items, ...day }) => day)).toEqual(before.map(({ items: _items, ...day }) => day));
    expect(after[0]).toEqual(before[0]);
    expect(after[2]).toEqual(before[2]);
    expect(after[1].items.filter((i) => i.id !== lunch.id)).toEqual(before[1].items.filter((i) => i.id !== lunch.id));
    expect(after[1].items.map((i) => i.id)).toEqual(before[1].items.map((i) => i.id));
  });

  it("schreibt Snapshot und Portion zum neuen Rezept; das alte Rezept bleibt unverändert", async () => {
    const { profileId, lentils, rice } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");

    await replacePlannedMeal(profileId, lunch.id, TODAY);

    const after = await itemIn(profileId, TODAY, "LUNCH");
    expect(after).toMatchObject({ recipeId: rice!.id, ...recipeSnapshotOf(rice!) });
    // Die neue Portion soll ungefähr liefern, was die alte Mahlzeit beitragen sollte (600 kcal × 1,25).
    expect(after.portionMultiplier).not.toBe(lunch.portionMultiplier);
    expect(after.recipeKcal! * after.portionMultiplier).toBeGreaterThan(600 * 1.25 * 0.85);
    expect(after.recipeKcal! * after.portionMultiplier).toBeLessThan(600 * 1.25 * 1.15);
    expect(await prisma.recipe.findUnique({ where: { id: lentils.id } })).toEqual(lentils);
  });

  it("ersetzt auch Einträge von vor den Snapshots (ohne Snapshot) und schreibt dann einen vollständigen", async () => {
    const { profileId, rice } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    await prisma.mealPlanItem.update({
      where: { id: lunch.id },
      data: { recipeName: null, recipeKcal: null, recipeProteinG: null, recipeCarbsG: null, recipeFatG: null },
    });

    await replacePlannedMeal(profileId, lunch.id, TODAY);

    expect(await itemIn(profileId, TODAY, "LUNCH")).toMatchObject(recipeSnapshotOf(rice!));
  });
});

describe("replacePlannedMeal: Kandidaten und harte Vorgaben (R5F-7)", () => {
  it("wählt nie ein Rezept mit einer Allergie des Profils, auch wenn es sonst am besten passt", async () => {
    const { profileId, rice } = await plannedWeek();
    // Gleiche Makro-Zusammensetzung wie das alte Rezept und trending - ohne Allergie die erste Wahl.
    await createSlotRecipe("Erdnuss-Curry", "LUNCH", { kcal: 600, proteinG: 30, carbsG: 70, fatG: 18, isTrending: true, ingredients: ["100 g Erdnüsse"] });
    await prisma.profileTag.create({ data: { label: "Erdnüsse", allergyOfProfileId: profileId } });

    const result = await replacePlannedMeal(profileId, (await itemIn(profileId, TODAY, "LUNCH")).id, TODAY);

    expect(result).toMatchObject({ ok: true, item: { recipeId: rice!.id } });
  });

  it.each([
    ["nur mit Allergie", { ingredients: ["100 g Erdnüsse"] }, "allergy"],
    ["nicht zur Ernährungsform passend", { dietTypes: ["VEGAN"] }, null],
    ["mit einer Abneigung", { ingredients: ["200 g Pilze"] }, "dislike"],
  ] as const)("ohne gültigen Kandidaten (Alternative %s) kontrollierter Fehler, nichts ändert sich", async (_label, options: RecipeOptions, tag) => {
    const { profileId } = await plannedWeek({ withAlternative: false });
    await createSlotRecipe("Alternative", "LUNCH", options);
    if (tag === "allergy") await prisma.profileTag.create({ data: { label: "Erdnüsse", allergyOfProfileId: profileId } });
    if (tag === "dislike") await prisma.profileTag.create({ data: { label: "Pilze", dislikedByProfileId: profileId } });
    const before = await allDays(profileId);

    expect(await replacePlannedMeal(profileId, (await itemIn(profileId, TODAY, "LUNCH")).id, TODAY)).toEqual({ ok: false, error: "NO_CANDIDATE" });
    expect(await allDays(profileId)).toEqual(before);
  });

  it("ohne anderes Rezept für den Slot: kontrollierter Fehler statt erneut dasselbe Rezept", async () => {
    const { profileId } = await plannedWeek({ withAlternative: false });
    // Ein Rezept nur fürs Abendessen ist kein Kandidat fürs Mittagessen.
    await createSlotRecipe("Nur abends", "DINNER");
    const before = await allDays(profileId);

    expect(await replacePlannedMeal(profileId, (await itemIn(profileId, TODAY, "LUNCH")).id, TODAY)).toEqual({ ok: false, error: "NO_CANDIDATE" });
    expect(await allDays(profileId)).toEqual(before);
  });

  it("berücksichtigt die Wochenverwendung: ein in dieser Woche schon geplantes Rezept tritt hinter ein fast gleich passendes zurück", async () => {
    const { profileId } = await plannedWeek({ withAlternative: false });
    // Gleiche Zusammensetzung wie das alte Rezept (passt am besten) bzw. leicht abweichend.
    const exact = await createSlotRecipe("Linsen-Dal", "LUNCH", { kcal: 300, proteinG: 15, carbsG: 35, fatG: 9 });
    const close = await createSlotRecipe("Bohnen-Chili", "LUNCH", { kcal: 600, proteinG: 28, carbsG: 72, fatG: 18 });

    // Ohne Verwendung in der Woche gewinnt das genau passende Rezept ...
    const tomorrowLunch = await itemIn(profileId, TOMORROW, "LUNCH");
    expect(await replacePlannedMeal(profileId, tomorrowLunch.id, TODAY)).toMatchObject({ ok: true, item: { recipeId: exact.id } });

    // ... steht es (jetzt morgen) schon im Plan der Woche, wird heute das fast gleich passende gewählt.
    const todayLunch = await itemIn(profileId, TODAY, "LUNCH");
    expect(await replacePlannedMeal(profileId, todayLunch.id, TODAY)).toMatchObject({ ok: true, item: { recipeId: close.id } });
  });

  it("zählt auch historische Tage derselben Woche für die Abwechslung", async () => {
    const { profileId, lentils, breakfast, dinner } = await plannedWeek({ withAlternative: false });
    const exact = await createSlotRecipe("Linsen-Dal", "LUNCH", { kcal: 300, proteinG: 15, carbsG: 35, fatG: 9 });
    const close = await createSlotRecipe("Bohnen-Chili", "LUNCH", { kcal: 600, proteinG: 28, carbsG: 72, fatG: 18 });
    await prisma.mealPlanDay.delete({ where: { profileId_date: { profileId, date: toDbDate(YESTERDAY) } } });
    await storePlanDay(profileId, YESTERDAY, [
      { slot: "BREAKFAST", time: "08:00", recipe: breakfast, portionMultiplier: 1 },
      { slot: "LUNCH", time: "13:00", recipe: exact, portionMultiplier: 2 },
      { slot: "DINNER", time: "19:30", recipe: dinner, portionMultiplier: 1 },
    ]);
    expect(lentils.id).not.toBe(exact.id);

    const result = await replacePlannedMeal(profileId, (await itemIn(profileId, TODAY, "LUNCH")).id, TODAY);

    expect(result).toMatchObject({ ok: true, item: { recipeId: close.id } });
  });
});

describe("replacePlannedMeal: Zugriff (R5F-7)", () => {
  it("fremde und unbekannte Einträge gelten als nicht gefunden; der fremde Plan bleibt unverändert", async () => {
    const owner = await plannedWeek();
    const { profile: other } = await createPerson("B");
    const ownersLunch = await itemIn(owner.profileId, TODAY, "LUNCH");
    const before = await allDays(owner.profileId);

    expect(await replacePlannedMeal(other.id, ownersLunch.id, TODAY)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await replacePlannedMeal(other.id, "unbekannt", TODAY)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(await allDays(owner.profileId)).toEqual(before);
  });
});

describe("replacePlannedMeal: Konsistenz (R5F-7)", () => {
  it("scheitert das Schreiben, bleibt alles unverändert", async () => {
    const { profileId } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    const before = await allDays(profileId);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5f7_fail_item_update BEFORE UPDATE ON "MealPlanItem" BEGIN SELECT RAISE(ABORT, 'R5F7 injected failure'); END;`,
    );

    await expect(replacePlannedMeal(profileId, lunch.id, TODAY)).rejects.toThrow();
    expect(await allDays(profileId)).toEqual(before);
  });

  it("wurde der Eintrag seit dem Lesen geändert (z.B. parallel ersetzt), wird nichts überschrieben", async () => {
    const { profileId, dinner } = await plannedWeek();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");
    const client = prisma as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
    const transaction = client.$transaction;
    // Ein paralleler Request ändert den Eintrag zwischen Auswahl und Schreiben.
    client.$transaction = async (...args) => {
      await prisma.mealPlanItem.update({ where: { id: lunch.id }, data: { recipeId: dinner.id } });
      return transaction.apply(prisma, args);
    };
    try {
      expect(await replacePlannedMeal(profileId, lunch.id, TODAY)).toEqual({ ok: false, error: "CHANGED" });
    } finally {
      client.$transaction = transaction;
    }
    expect(await itemIn(profileId, TODAY, "LUNCH")).toMatchObject({ recipeId: dinner.id, recipeName: lunch.recipeName });
  });
});

describe("POST /api/plan/items/[id]/replace (R5F-7)", () => {
  /** 00:30 Uhr am 24.09. in Berlin - in UTC ist es noch der 23.09., 22:30. */
  const SERVER_NOW = new Date("2026-09-24T00:30:00+02:00");

  function post(id: string) {
    return replaceRoute.POST(new Request(`http://localhost/api/plan/items/${id}/replace`, { method: "POST" }), { params: Promise.resolve({ id }) });
  }

  async function signedIn() {
    const week = await plannedWeek();
    session.userId = week.user.id;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW);
    return week;
  }

  it("lehnt eine nicht angemeldete Anfrage mit 401 ab und ändert nichts", async () => {
    const { profileId } = await plannedWeek();
    const before = await allDays(profileId);

    const res = await post((await itemIn(profileId, TODAY, "LUNCH")).id);

    expect(res.status).toBe(401);
    expect(await allDays(profileId)).toEqual(before);
  });

  it("liefert 404 ohne Profil", async () => {
    const { user } = await createPerson("B");
    await prisma.profile.delete({ where: { userId: user.id } });
    session.userId = user.id;

    expect((await post("egal")).status).toBe(404);
  });

  it("ersetzt die Mahlzeit und liefert den neuen Eintrag samt Rezept", async () => {
    const { profileId, rice } = await signedIn();
    const lunch = await itemIn(profileId, TODAY, "LUNCH");

    const res = await post(lunch.id);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ item: { id: lunch.id, recipeId: rice!.id, recipeName: "Reis-Bowl", recipe: { id: rice!.id } } });
  });

  it("gestern ist nach deutschem Kalendertag historisch (409), auch wenn es in UTC noch heute ist", async () => {
    const { profileId } = await signedIn();
    const before = await allDays(profileId);

    const res = await post((await itemIn(profileId, YESTERDAY, "LUNCH")).id);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Mahlzeiten vergangener Tage lassen sich nicht mehr ersetzen." });
    expect(await allDays(profileId)).toEqual(before);
  });

  it("antwortet mit kontrollierten Fehlern: fremd 404, geloggt 409, kein Kandidat 422", async () => {
    const { profileId, lentils, rice } = await signedIn();
    const other = await createPerson("B");
    const othersDay = await storePlanDay(other.profile.id, TODAY, [{ slot: "LUNCH", time: "13:00", recipe: lentils, portionMultiplier: 1 }]);
    const othersItem = await prisma.mealPlanItem.findFirstOrThrow({ where: { mealPlanDayId: othersDay.id } });
    expect((await post(othersItem.id)).status).toBe(404);

    await logMeal(profileId, TODAY, "LUNCH", lentils.id);
    expect((await post((await itemIn(profileId, TODAY, "LUNCH")).id)).status).toBe(409);

    await prisma.mealPlanItem.updateMany({ where: { recipeId: rice!.id }, data: { recipeId: lentils.id } });
    await prisma.recipe.delete({ where: { id: rice!.id } });
    const res = await post((await itemIn(profileId, TOMORROW, "LUNCH")).id);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "Für diese Mahlzeit gibt es gerade kein anderes passendes Rezept." });
  });

  it("ein DB-Fehler ergibt 500 mit allgemeiner Meldung, ohne technische Details; nichts ist geändert", async () => {
    const { profileId } = await signedIn();
    const before = await allDays(profileId);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER r5f7_fail_item_update BEFORE UPDATE ON "MealPlanItem" BEGIN SELECT RAISE(ABORT, 'R5F7 injected failure'); END;`,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post((await itemIn(profileId, TODAY, "LUNCH")).id);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Die Mahlzeit konnte gerade nicht ersetzt werden. Versuch es nochmal." });
    expect(await allDays(profileId)).toEqual(before);
  });
});
