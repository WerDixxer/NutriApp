import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbDate } from "@/lib/calendarDate";
import { pushSchema, removeIsolatedDatabase } from "@/test/isolatedDatabase";

/**
 * /api/profile gegen eine isolierte SQLite-Datenbank (R2): echte Prisma-Abfragen statt Mocks,
 * damit geprüft wird, was die Route tatsächlich an den Browser schickt (F-02) und dass ein
 * fehlgeschlagenes Update keinen halben Profilzustand hinterlässt (F-05). Nur die Session ist
 * ersetzt; die echte prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r2-profile-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { GET, POST } = await import("./route");
const { loadProfileForForm } = await import("@/app/onboarding/profileLoad");

/** Nur ein Platzhalterwert im bcrypt-Format - er darf in keiner Antwort auftauchen. */
const PASSWORD_HASH = "$2a$12$r2TestOnlyHashValueThatMustNeverReachTheBrowser1234567";
const FAILING_DURATION_MIN = 599;
/** Prisma meldet einen per SQLite-Trigger (RAISE ABORT) abgebrochenen Insert als Constraint-Verletzung P2003. */
const INJECTED_FAILURE = { name: "PrismaClientKnownRequestError", code: "P2003" };

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS r2_fail_training_insert`);
  await prisma.mealPlanDay.deleteMany();
  await prisma.trainingSession.deleteMany();
  await prisma.profileTag.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
  session.userId = null;
});

async function createUser() {
  return prisma.user.create({
    data: { name: "Testperson", email: "r2-profile@test.invalid", passwordHash: PASSWORD_HASH, emailVerified: new Date("2026-01-01") },
  });
}

async function createUserWithProfile() {
  const user = await createUser();
  const profile = await prisma.profile.create({
    data: {
      userId: user.id,
      age: 34,
      sex: "FEMALE",
      heightCm: 168,
      weightKg: 62,
      activityLevel: "MODERATE",
      goal: "MAINTAIN",
      goalRateKgPerWeek: 0.5,
      sportType: "STRENGTH",
      dietType: "VEGETARIAN",
      subscribedTrendTags: JSON.stringify(["high-protein"]),
      likedFoods: { create: [{ label: "Skyr" }] },
      dislikedFoods: { create: [{ label: "Paprika" }] },
      allergies: { create: [{ label: "Erdnüsse" }] },
      priorities: { create: [{ label: "schnell" }] },
      trainingSessions: { create: [{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }] },
    },
  });
  await prisma.mealPlanDay.create({
    data: { profileId: profile.id, date: new Date(2026, 8, 24), targetKcal: 2000, targetProteinG: 120, targetCarbsG: 200, targetFatG: 70 },
  });
  session.userId = user.id;
  return { user, profile };
}

function updatePayload(overrides: Record<string, unknown> = {}) {
  return {
    age: 35,
    sex: "FEMALE",
    heightCm: 168,
    weightKg: 60,
    activityLevel: "HIGH",
    goal: "GAIN_MUSCLE",
    goalRateKgPerWeek: 0.25,
    sportType: "STRENGTH",
    dietType: "VEGETARIAN",
    likedFoods: ["Haferflocken"],
    dislikedFoods: [],
    allergies: ["Nüsse", "Sesam"],
    priorities: [],
    trainingSessions: [{ weekday: 3, startTime: "07:00", durationMin: 45, sportType: "ENDURANCE", intensity: 4 }],
    ...overrides,
  };
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function profileState(profileId: string) {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { allergies: true, likedFoods: true, dislikedFoods: true, priorities: true, trainingSessions: true },
  });
  return {
    weightKg: profile.weightKg,
    goal: profile.goal,
    allergies: profile.allergies.map((t) => t.label),
    likedFoods: profile.likedFoods.map((t) => t.label),
    dislikedFoods: profile.dislikedFoods.map((t) => t.label),
    priorities: profile.priorities.map((t) => t.label),
    trainingSessions: profile.trainingSessions.map((s) => ({ weekday: s.weekday, startTime: s.startTime, durationMin: s.durationMin })),
    mealPlanDays: await prisma.mealPlanDay.count({ where: { profileId } }),
    profileTagRows: await prisma.profileTag.count(),
  };
}

/** Bricht in DIESER Testdatenbank das Anlegen einer Trainingseinheit mit 599 Minuten ab - ein echter DB-Fehler mitten im Update. */
async function injectTrainingInsertFailure() {
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER r2_fail_training_insert BEFORE INSERT ON "TrainingSession" WHEN NEW."durationMin" = ${FAILING_DURATION_MIN} BEGIN SELECT RAISE(ABORT, 'R2 injected failure'); END;`,
  );
}

// ---------------------------------------------------------------------------
// F-02: passwordHash darf nie im Browser landen
// ---------------------------------------------------------------------------

const CLIENT_PROFILE_FIELDS = [
  "activityLevel",
  "age",
  "allergies",
  "dietType",
  "dislikedFoods",
  "goal",
  "goalRateKgPerWeek",
  "heightCm",
  "likedFoods",
  "priorities",
  "sex",
  "sportType",
  "subscribedTrendTags",
  "trainingSessions",
  "weightKg",
];

describe("GET /api/profile (F-02)", () => {
  it("liefert alle Daten, die Onboarding und Trends-Seite brauchen", async () => {
    await createUserWithProfile();
    const res = await GET();
    expect(res.status).toBe(200);
    const { profile } = await res.json();

    expect(profile).toMatchObject({
      age: 34,
      sex: "FEMALE",
      heightCm: 168,
      weightKg: 62,
      activityLevel: "MODERATE",
      goal: "MAINTAIN",
      goalRateKgPerWeek: 0.5,
      sportType: "STRENGTH",
      dietType: "VEGETARIAN",
      subscribedTrendTags: ["high-protein"],
    });
    expect(profile.likedFoods).toEqual([{ label: "Skyr" }]);
    expect(profile.dislikedFoods).toEqual([{ label: "Paprika" }]);
    expect(profile.allergies).toEqual([{ label: "Erdnüsse" }]);
    expect(profile.priorities).toEqual([{ label: "schnell" }]);
    expect(profile.trainingSessions).toEqual([{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }]);
  });

  it("enthält weder passwordHash noch andere Server-Felder - nur die explizit freigegebenen Felder", async () => {
    await createUserWithProfile();
    const res = await GET();
    const raw = await res.text();

    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain(PASSWORD_HASH);
    expect(raw).not.toContain("emailVerified");
    expect(raw).not.toContain("r2-profile@test.invalid");

    const { profile } = JSON.parse(raw);
    expect(Object.keys(profile).sort()).toEqual(CLIENT_PROFILE_FIELDS);
    for (const list of [profile.likedFoods, profile.dislikedFoods, profile.allergies, profile.priorities]) {
      for (const tag of list) expect(Object.keys(tag)).toEqual(["label"]);
    }
  });

  it("ohne Profil: profile ist null, ohne Login: 401", async () => {
    const user = await createUser();
    session.userId = user.id;
    expect(await (await GET()).json()).toEqual({ profile: null });

    session.userId = null;
    expect((await GET()).status).toBe(401);
  });

  it("liefert bei unlesbaren Trend-Tags keinen stillen Fallback [], der beim nächsten Speichern die Tags überschreiben würde (R5D)", async () => {
    const { user, profile } = await createUserWithProfile();
    await prisma.profile.update({ where: { id: profile.id }, data: { subscribedTrendTags: "high-protein,vegan" } });

    await expect(GET()).rejects.toThrow(`Profile userId=${user.id}: Spalte "subscribedTrendTags" enthält kein gültiges JSON.`);
    expect((await prisma.profile.findUniqueOrThrow({ where: { id: profile.id } })).subscribedTrendTags).toBe("high-protein,vegan");
  });
});

// ---------------------------------------------------------------------------
// F-05: Profiländerungen atomar
// ---------------------------------------------------------------------------

describe("POST /api/profile (F-05)", () => {
  it("ersetzt Profilwerte, Tags und Trainingseinheiten vollständig (normaler Pfad)", async () => {
    const { profile } = await createUserWithProfile();
    const res = await POST(postRequest(updatePayload()));
    expect(res.status).toBe(200);

    expect(await profileState(profile.id)).toEqual({
      weightKg: 60,
      goal: "GAIN_MUSCLE",
      allergies: ["Nüsse", "Sesam"],
      likedFoods: ["Haferflocken"],
      dislikedFoods: [],
      priorities: [],
      trainingSessions: [{ weekday: 3, startTime: "07:00", durationMin: 45 }],
      mealPlanDays: 1, // R5E: Speichern löscht keine Tagespläne mehr
      profileTagRows: 3,
    });
  });

  it("lässt vergangene und spätere Tagespläne samt Einträgen unverändert (R5E)", async () => {
    const { profile } = await createUserWithProfile();
    const recipe = await prisma.recipe.create({
      data: {
        name: "Reis-Bowl",
        description: "",
        kcal: 450,
        proteinG: 25,
        carbsG: 50,
        fatG: 12,
        prepTimeMin: 15,
        mealSlots: '["LUNCH"]',
        dietTypes: '["VEGETARIAN"]',
        allergens: "[]",
        ingredients: '["150 g Reis"]',
        instructions: '["Reis kochen."]',
      },
    });
    // Ob ein Tag vergangen ist, spielt hier keine Rolle: Speichern darf gar keinen Tagesplan löschen oder ändern.
    for (const date of ["2026-09-20", "2026-10-05"] as const) {
      await prisma.mealPlanDay.create({
        data: {
          profileId: profile.id,
          date: toDbDate(date),
          targetKcal: 1800,
          targetProteinG: 100,
          targetCarbsG: 200,
          targetFatG: 60,
          items: { create: [{ slot: "LUNCH", time: "12:30", recipeId: recipe.id, portionMultiplier: 1.2 }] },
        },
      });
    }
    const storedPlans = () =>
      prisma.mealPlanDay.findMany({ where: { profileId: profile.id }, include: { items: true }, orderBy: { date: "asc" } });
    const before = await storedPlans();

    const res = await POST(postRequest(updatePayload({ allergies: ["Reis"], weightKg: 70 })));

    expect(res.status).toBe(200);
    expect(before).toHaveLength(3);
    expect(await storedPlans()).toEqual(before);
  });

  it("ein Fehler mitten im Update hinterlässt keinen halben Zustand: Profil, Allergien, Tags und Pläne bleiben unverändert", async () => {
    const { profile } = await createUserWithProfile();
    const before = await profileState(profile.id);
    await injectTrainingInsertFailure();

    const failing = updatePayload({
      trainingSessions: [{ weekday: 3, startTime: "07:00", durationMin: FAILING_DURATION_MIN, sportType: "ENDURANCE", intensity: 4 }],
    });
    await expect(POST(postRequest(failing))).rejects.toMatchObject(INJECTED_FAILURE);

    expect(await profileState(profile.id)).toEqual(before);
    expect(before.allergies).toEqual(["Erdnüsse"]);
    expect(before.mealPlanDays).toBe(1);
  });

  it("ein Fehler beim ersten Anlegen hinterlässt kein Profil ohne Allergien", async () => {
    const user = await createUser();
    session.userId = user.id;
    await injectTrainingInsertFailure();

    const failing = updatePayload({
      trainingSessions: [{ weekday: 3, startTime: "07:00", durationMin: FAILING_DURATION_MIN, sportType: "ENDURANCE", intensity: 4 }],
    });
    await expect(POST(postRequest(failing))).rejects.toMatchObject(INJECTED_FAILURE);

    expect(await prisma.profile.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.profileTag.count()).toBe(0);
  });

  it("legt ein neues Profil samt Allergien an (erstes Onboarding)", async () => {
    const user = await createUser();
    session.userId = user.id;
    const res = await POST(postRequest(updatePayload()));
    const { profileId } = await res.json();
    expect((await profileState(profileId)).allergies).toEqual(["Nüsse", "Sesam"]);
  });
});

// ---------------------------------------------------------------------------
// F-19: kaputter Request-Body
// ---------------------------------------------------------------------------

describe("POST /api/profile: Request-Body (F-19)", () => {
  it("kaputtes JSON ergibt 400 statt 500; Profil, Allergien und Pläne bleiben unverändert", async () => {
    const { profile } = await createUserWithProfile();
    const before = await profileState(profile.id);

    const res = await POST(new Request("http://localhost/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: '{"age": 35,' }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Ungültige Anfrage: Der Inhalt ist kein gültiges JSON." });
    expect(await profileState(profile.id)).toEqual(before);
  });

  it("gültiges JSON mit falscher Struktur bekommt weiterhin die Meldung des Schemas", async () => {
    await createUserWithProfile();
    const res = await POST(postRequest({ foo: "bar" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toContain("kein gültiges JSON");
  });
});

// ---------------------------------------------------------------------------
// R5E-3: Profil speichern meldet, ob heutige/künftige Pläne angepasst werden sollten
// ---------------------------------------------------------------------------

describe("POST /api/profile: Hinweis auf Plananpassung (R5E-3)", () => {
  /** Serveruhr: 10.10.2026, 10:00 Uhr in Berlin. Der Tagesplan aus createUserWithProfile (24.09.) ist damit historisch. */
  const SERVER_NOW = new Date("2026-10-10T10:00:00+02:00");

  /** Dieselben planrelevanten Werte wie in createUserWithProfile. */
  function unchangedPlanPayload(overrides: Record<string, unknown> = {}) {
    return {
      age: 34,
      sex: "FEMALE",
      heightCm: 168,
      weightKg: 62,
      activityLevel: "MODERATE",
      goal: "MAINTAIN",
      goalRateKgPerWeek: 0.5,
      sportType: "STRENGTH",
      dietType: "VEGETARIAN",
      likedFoods: ["Skyr"],
      dislikedFoods: ["Paprika"],
      allergies: ["Erdnüsse"],
      priorities: ["schnell"],
      trainingSessions: [{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }],
      ...overrides,
    };
  }

  async function storeDayPlan(profileId: string, day: "2026-10-10" | "2026-10-11" | "2026-10-12") {
    return prisma.mealPlanDay.create({
      data: { profileId, date: toDbDate(day), targetKcal: 2000, targetProteinG: 110, targetCarbsG: 230, targetFatG: 70 },
    });
  }

  function storedPlans(profileId: string) {
    return prisma.mealPlanDay.findMany({ where: { profileId }, include: { items: true }, orderBy: { date: "asc" } });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(SERVER_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["heute", "2026-10-10"],
    ["ein künftiger Tag", "2026-10-12"],
  ] as const)("planrelevante Änderung und gespeicherter bearbeitbarer Tag (%s): needed true, Pläne unverändert", async (_label, day) => {
    const { profile } = await createUserWithProfile();
    await storeDayPlan(profile.id, day);
    const before = await storedPlans(profile.id);

    const res = await POST(postRequest(unchangedPlanPayload({ allergies: ["Erdnüsse", "Milch"] })));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ profileId: profile.id, planAdaptation: { needed: true } });
    expect(await storedPlans(profile.id)).toEqual(before);
  });

  it.each([
    ["Ernährungsform", { dietType: "VEGAN" }],
    ["Gewicht (Tagesziel)", { weightKg: 64 }],
    ["Abneigung", { dislikedFoods: ["Paprika", "Pilze"] }],
    ["Trainingszeit", { trainingSessions: [{ weekday: 1, startTime: "07:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }] }],
  ])("fragt auch bei geänderter %s", async (_label, change) => {
    const { profile } = await createUserWithProfile();
    await storeDayPlan(profile.id, "2026-10-12");

    const res = await POST(postRequest(unchangedPlanPayload(change)));

    expect((await res.json()).planAdaptation).toEqual({ needed: true });
  });

  it("fragt nicht, wenn es nur historische Tagespläne gibt", async () => {
    const { profile } = await createUserWithProfile();
    const before = await storedPlans(profile.id);

    const res = await POST(postRequest(unchangedPlanPayload({ dietType: "VEGAN" })));

    expect((await res.json()).planAdaptation).toEqual({ needed: false });
    expect(await storedPlans(profile.id)).toEqual(before);
  });

  it("richtet sich nach dem deutschen Kalendertag: um 00:30 Uhr ist der Vortag historisch, obwohl er in UTC noch läuft", async () => {
    const { profile } = await createUserWithProfile();
    await storeDayPlan(profile.id, "2026-10-11");
    vi.setSystemTime(new Date("2026-10-12T00:30:00+02:00"));

    const res = await POST(postRequest(unchangedPlanPayload({ dietType: "VEGAN" })));

    expect((await res.json()).planAdaptation).toEqual({ needed: false });
  });

  it.each([
    ["nur Prioritäten", { priorities: ["günstig"] }],
    ["nur Trainingsintensität", { trainingSessions: [{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 5 }] }],
    ["Listen nur umsortiert bzw. anders geschrieben", { allergies: ["ERDNÜSSE"], likedFoods: ["skyr"] }],
    ["gar nichts", {}],
  ])("fragt nicht bei Änderungen, die den Plan nicht beeinflussen: %s", async (_label, change) => {
    const { profile } = await createUserWithProfile();
    await storeDayPlan(profile.id, "2026-10-12");

    const res = await POST(postRequest(unchangedPlanPayload(change)));

    expect(res.status).toBe(200);
    expect((await res.json()).planAdaptation).toEqual({ needed: false });
  });

  it("fragt beim ersten Anlegen des Profils nicht", async () => {
    const user = await createUser();
    session.userId = user.id;

    const res = await POST(postRequest(unchangedPlanPayload()));

    expect(res.status).toBe(200);
    expect((await res.json()).planAdaptation).toEqual({ needed: false });
  });
});

// ---------------------------------------------------------------------------
// R5F-1: Das Profil-Formular deutet die echte GET-Antwort richtig
// ---------------------------------------------------------------------------

describe("GET /api/profile als Quelle des Profil-Formulars (R5F-1)", () => {
  it("ein gespeichertes Profil wird vollständig übernommen (auch die Allergien)", async () => {
    await createUserWithProfile();

    const state = await loadProfileForForm(() => GET());

    expect(state.status).toBe("existing");
    expect(state.status === "existing" && state.profile).toMatchObject({ age: 34, dietType: "VEGETARIAN", allergies: [{ label: "Erdnüsse" }] });
  });

  it("ohne Profil gilt das Formular als erstes Onboarding", async () => {
    const user = await createUser();
    session.userId = user.id;

    expect(await loadProfileForForm(() => GET())).toEqual({ status: "new" });
  });

  it("nicht angemeldet (401) ist ein Ladefehler, kein neues Profil", async () => {
    expect(await loadProfileForForm(() => GET())).toEqual({ status: "error" });
  });

  it("unlesbare gespeicherte Daten (GET scheitert) sperren das Speichern, statt mit Startwerten weiterzumachen", async () => {
    const { profile } = await createUserWithProfile();
    await prisma.profile.update({ where: { id: profile.id }, data: { subscribedTrendTags: "kaputt" } });

    expect(await loadProfileForForm(() => GET())).toEqual({ status: "error" });
  });
});
