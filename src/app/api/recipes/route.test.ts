import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toDbDate } from "@/lib/calendarDate";
import { databaseFixtures } from "@/test/databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "@/test/isolatedDatabase";

/**
 * DELETE /api/recipes gegen eine isolierte SQLite-Datenbank (R4B, F-09): Steckt ein eigenes Rezept
 * noch in einem Plan, blockiert die Datenbank das Löschen per Foreign Key (Restrict, siehe
 * src/test/referentialIntegrity.test.ts). Die Route muss daraus ein 409 mit einer Meldung für den
 * Nutzer machen - ohne Prisma-Details - und darf andere Fehler nicht als 409 tarnen. Nur die Session
 * ist ersetzt; prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r4b-recipes-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

const { prisma } = await import("@/lib/db");
const { DELETE, GET, POST } = await import("./route");
const { createPerson, createRecipe, createHousehold, planInDayPlan, planInHouseholdPlan, clearFixtureData } = databaseFixtures(prisma);

const RECIPE_IN_USE_MESSAGE = "Das Rezept kann nicht gelöscht werden, weil es noch in einem Essens- oder Wochenplan verwendet wird.";

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
  session.userId = null;
});

async function signedInPerson() {
  const person = await createPerson("A");
  session.userId = person.user.id;
  return person;
}

function deleteRequest(recipeId: string): Request {
  return new Request(`http://localhost/api/recipes?id=${recipeId}`, { method: "DELETE" });
}

function createRequest(): Request {
  const body = {
    name: "Linsen-Curry",
    kcal: 520,
    proteinG: 24,
    carbsG: 60,
    fatG: 14,
    prepTimeMin: 30,
    servings: 2,
    mealSlots: ["DINNER"],
    dietTypes: ["VEGAN"],
    ingredients: ["200 g Linsen"],
    instructions: ["Linsen kochen."],
  };
  return new Request("http://localhost/api/recipes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/recipes (R5E)", () => {
  it("legt das Rezept an und lässt bestehende Tagespläne samt Einträgen unverändert", async () => {
    const { profile } = await signedInPerson();
    const recipe = await createRecipe("Reis-Bowl");
    await planInDayPlan(profile.id, recipe.id);
    await prisma.mealPlanDay.create({
      data: {
        profileId: profile.id,
        date: toDbDate("2026-10-05"),
        targetKcal: 2000,
        targetProteinG: 110,
        targetCarbsG: 230,
        targetFatG: 70,
        items: { create: [{ slot: "DINNER", time: "19:00", recipeId: recipe.id }] },
      },
    });
    const storedPlans = () =>
      prisma.mealPlanDay.findMany({ where: { profileId: profile.id }, include: { items: true }, orderBy: { date: "asc" } });
    const before = await storedPlans();

    const res = await POST(createRequest());

    expect(res.status).toBe(200);
    expect(await prisma.recipe.count({ where: { ownerProfileId: profile.id, name: "Linsen-Curry" } })).toBe(1);
    expect(before).toHaveLength(2);
    expect(await storedPlans()).toEqual(before);
  });
});

describe("DELETE /api/recipes (F-09)", () => {
  it("löscht ein eigenes Rezept, das in keinem Plan steckt", async () => {
    const { profile } = await signedInPerson();
    const recipe = await createRecipe("Reis-Bowl", profile.id);

    const res = await DELETE(deleteRequest(recipe.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(0);
  });

  it("antwortet mit 409, wenn das Rezept im Tagesplan steckt (MealPlanItem); Rezept und Plan bleiben", async () => {
    const { profile } = await signedInPerson();
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    const dayPlan = await planInDayPlan(profile.id, recipe.id);

    const res = await DELETE(deleteRequest(recipe.id));

    expect(res.status).toBe(409);
    // Genau diese eine Meldung, keine Prisma-Codes, Tabellennamen oder Stacktraces.
    expect(await res.json()).toEqual({ error: RECIPE_IN_USE_MESSAGE });
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
    expect(await prisma.mealPlanDay.count({ where: { id: dayPlan.id } })).toBe(1);
    expect(await prisma.mealPlanItem.count({ where: { mealPlanDayId: dayPlan.id, recipeId: recipe.id } })).toBe(1);
  });

  it("antwortet mit 409, wenn das Rezept im Essensplan des Haushalts steckt (MealPlanMeal); Rezept und Plan bleiben", async () => {
    const { user, profile } = await signedInPerson();
    const household = await createHousehold(user.id);
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    const mealPlan = await planInHouseholdPlan(household.id, recipe.id);

    const res = await DELETE(deleteRequest(recipe.id));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: RECIPE_IN_USE_MESSAGE });
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
    expect(await prisma.mealPlanMeal.count({ where: { mealPlanId: mealPlan.id, recipeId: recipe.id } })).toBe(1);
  });

  // Andere Datenbankfehler lassen sich ohne künstlichen Umbau der Testdatenbank nicht natürlich
  // auslösen, deshalb schlägt hier gezielt der eine Löschaufruf fehl. Die Route darf sie nicht in
  // ein 409 verwandeln, sondern muss sie weiterwerfen (Next.js antwortet dann mit 500).
  it.each([
    ["ein anderer Prisma-Fehler (P2034, Schreibkonflikt)", new Prisma.PrismaClientKnownRequestError("Transaction failed due to a write conflict", { code: "P2034", clientVersion: Prisma.prismaVersion.client })],
    ["ein unerwarteter Fehler ohne Prisma-Code", new Error("Verbindung zur Datenbank verloren")],
  ])("wirft %s weiter statt 409 zu antworten", async (_label, failure) => {
    const { profile } = await signedInPerson();
    const recipe = await createRecipe("Reis-Bowl", profile.id);
    // Nur der nächste Aufruf schlägt fehl, danach ruft der Spy wieder die echte Methode auf.
    // Kein mockRestore: Auf Prisma-Delegates entfernt es die Methode ganz, statt sie zurückzusetzen.
    vi.spyOn(prisma.recipe, "deleteMany").mockRejectedValueOnce(failure);

    await expect(DELETE(deleteRequest(recipe.id))).rejects.toBe(failure);
    expect(await prisma.recipe.count({ where: { id: recipe.id } })).toBe(1);
  });
});

describe("GET /api/recipes: Anmeldung und eigene Rezepte (R5F-12)", () => {
  it("ohne Anmeldung 401 statt einer leeren Erfolgsliste", async () => {
    await createRecipe("Eigene Bowl", (await createPerson("A")).profile.id);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Nicht angemeldet." });
  });

  it("liefert genau die eigenen Rezepte, neueste zuerst - keine Katalogrezepte und keine fremden privaten", async () => {
    const other = await createPerson("B");
    await createRecipe("Fremdes Geheimrezept", other.profile.id);
    await createRecipe("Katalog-Bowl");
    const { profile } = await signedInPerson();
    const older = await createRecipe("Ältere eigene Bowl", profile.id);
    await prisma.recipe.update({ where: { id: older.id }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
    const newer = await createRecipe("Neuere eigene Bowl", profile.id);

    const res = await GET();

    expect(res.status).toBe(200);
    const { recipes } = await res.json();
    expect(recipes.map((r: { id: string }) => r.id)).toEqual([newer.id, older.id]);
    expect(recipes.every((r: { ownerProfileId: string; isCustom: boolean }) => r.ownerProfileId === profile.id && r.isCustom)).toBe(true);
  });

  it("angemeldet ohne Profil: wie bisher 200 mit leerer Liste", async () => {
    const user = await prisma.user.create({ data: { name: "Ohne Profil" } });
    session.userId = user.id;

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recipes: [] });
  });
});

describe("POST/DELETE /api/recipes: Profil aus der Session (R5F-12)", () => {
  it("ohne Profil 404 'Kein Profil vorhanden.', ohne Anmeldung 401 - nichts wird angelegt oder gelöscht", async () => {
    const other = await createPerson("B");
    const foreign = await createRecipe("Fremdes Rezept", other.profile.id);
    expect((await POST(createRequest())).status).toBe(401);

    const user = await prisma.user.create({ data: { name: "Ohne Profil" } });
    session.userId = user.id;
    const created = await POST(createRequest());
    const deleted = await DELETE(deleteRequest(foreign.id));

    expect(created.status).toBe(404);
    expect(await created.json()).toEqual({ error: "Kein Profil vorhanden." });
    expect(deleted.status).toBe(404);
    expect(await prisma.recipe.count({ where: { name: "Linsen-Curry" } })).toBe(0);
    expect(await prisma.recipe.findUnique({ where: { id: foreign.id } })).not.toBeNull();
  });

  it("ein fremdes eigenes Rezept lässt sich nicht löschen; das neue Rezept gehört dem angemeldeten Profil", async () => {
    const other = await createPerson("B");
    const foreign = await createRecipe("Fremdes Rezept", other.profile.id);
    const { profile } = await signedInPerson();

    expect((await DELETE(deleteRequest(foreign.id))).status).toBe(200);
    expect(await prisma.recipe.findUnique({ where: { id: foreign.id } })).not.toBeNull();

    const { recipe } = await (await POST(createRequest())).json();
    expect(recipe).toMatchObject({ ownerProfileId: profile.id, isCustom: true });
  });
});
