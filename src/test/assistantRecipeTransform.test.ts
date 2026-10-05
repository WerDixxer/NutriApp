import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { databaseFixtures } from "./databaseFixtures";
import { pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * KI-umgeschriebene Rezepte (Food Assistant, TRANSFORM_RECIPE) laufen vor dem Speichern durch das zentrale
 * Rezept-Schema (R5F-8). Echte Route und Pipeline gegen eine isolierte SQLite-Datenbank; ersetzt sind nur
 * die Session und der LLM-Provider. prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r5f8-transform-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/session", () => ({ getApiUserId: async () => session.userId }));

/** Fake-LLM: beantwortet die Extraktion mit TRANSFORM_RECIPE und das Umschreiben mit `transformInput`. */
const llm = vi.hoisted(() => ({
  instruction: "proteinreicher",
  transformInput: null as unknown,
  transformAnswersWithText: false,
  transformCalls: 0,
}));
vi.mock("@/lib/agents/llmProvider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/llmProvider")>();
  return {
    ...actual,
    getLLMProvider: () => ({
      name: "fake",
      chat: async ({ tools }: { tools?: { name: string }[] }) => {
        const tool = tools?.[0]?.name;
        if (tool === "extract_query") {
          const input = { intent: "TRANSFORM_RECIPE", query: { recipeReference: "Linsen-Curry", instruction: llm.instruction } };
          return { content: [{ type: "tool_use", id: "t1", name: tool, input }], stopReason: "tool_use" };
        }
        if (tool === "submit_transformed_recipe") {
          llm.transformCalls++;
          if (llm.transformAnswersWithText) return { content: [{ type: "text", text: "Hier ist dein Rezept ..." }], stopReason: "end_turn" };
          return { content: [{ type: "tool_use", id: "t2", name: tool, input: llm.transformInput }], stopReason: "tool_use" };
        }
        throw new Error(`Unerwarteter LLM-Aufruf: ${tool}`);
      },
    }),
  };
});

const { prisma } = await import("@/lib/db");
const { POST } = await import("@/app/api/assistant/route");
const { createPerson, clearFixtureData } = databaseFixtures(prisma);

const GENERIC_ERROR = { error: "Der Assistent hatte gerade ein Problem. Versuch es nochmal." };

/** Gültige Antwort der KI (mit Leerzeichen und ungerundeten Werten, wie sie die KI liefern kann). */
const VALID_AI_RECIPE = {
  name: "  Linsen-Curry mit Skyr  ",
  description: "Mehr Protein durch Skyr.",
  ingredients: ["200 g Linsen", "150 g Skyr"],
  instructions: ["Linsen kochen.", "Mit Skyr anrichten."],
  kcal: 712.6,
  proteinG: 48.27,
  carbsG: 70.04,
  fatG: 15.56,
};

let profileId: string;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await clearFixtureData();
  const person = await createPerson("A");
  profileId = person.profile.id;
  session.userId = person.user.id;
  llm.instruction = "proteinreicher";
  llm.transformInput = VALID_AI_RECIPE;
  llm.transformAnswersWithText = false;
  llm.transformCalls = 0;
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Das eigene Original-Rezept; `columns` überschreibt gespeicherte Spalten (auch als JSON-Text). */
function createOriginal(columns: Record<string, unknown> = {}) {
  return prisma.recipe.create({
    data: {
      name: "Linsen-Curry",
      description: "Würziges Curry.",
      kcal: 600,
      proteinG: 30,
      carbsG: 70,
      fatG: 18,
      prepTimeMin: 25,
      servings: 2,
      mealSlots: JSON.stringify(["LUNCH", "DINNER"]),
      dietTypes: JSON.stringify(["VEGETARIAN"]),
      allergens: JSON.stringify(["Sellerie"]),
      tags: JSON.stringify(["schnell"]),
      ingredients: JSON.stringify(["200 g Linsen", "1 Dose Tomaten"]),
      instructions: JSON.stringify(["Kochen."]),
      isCustom: true,
      sourceType: "user",
      ownerProfileId: profileId,
      ...columns,
    },
  });
}

function askAssistant() {
  return POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Mach das Linsen-Curry proteinreicher" }),
    }),
  );
}

function transformedRecipes() {
  return prisma.recipe.findMany({ where: { generatedByAssistant: true } });
}

/** Ein abgelehntes Ergebnis: allgemeine 500-Antwort, nichts gespeichert, Grund nur im Server-Log. */
async function expectRejectedWithoutPersisting(res: Response, reason: RegExp) {
  const body = await res.json();
  expect(res.status).toBe(500);
  expect(body).toEqual(GENERIC_ERROR);
  expect(await transformedRecipes()).toEqual([]);
  expect(await prisma.recipe.count()).toBe(1);
  expect(await prisma.assistantMessage.count()).toBe(0);
  const [, loggedError] = consoleError.mock.calls.at(-1) ?? [];
  expect((loggedError as Error).message).toMatch(reason);
}

const AI_OUTPUT_INVALID = /^Die KI hat kein gültiges umgeschriebenes Rezept zurückgegeben/;
const PAYLOAD_INVALID = /^Das umgeschriebene Rezept erfüllt die Rezeptvorgaben nicht/;

describe("KI-umgeschriebenes Rezept: gültige Ausgabe (R5F-8)", () => {
  it("wird gespeichert: geprüfte, normalisierte KI-Felder plus die vom Original übernommenen Angaben", async () => {
    const original = await createOriginal();

    const res = await askAssistant();

    expect(res.status).toBe(200);
    const [saved] = await transformedRecipes();
    expect(saved).toMatchObject({
      name: "Linsen-Curry mit Skyr",
      description: "Mehr Protein durch Skyr.",
      kcal: 713,
      proteinG: 48.3,
      carbsG: 70,
      fatG: 15.6,
      prepTimeMin: 25,
      servings: 2,
      mealSlots: JSON.stringify(["LUNCH", "DINNER"]),
      dietTypes: JSON.stringify(["VEGETARIAN"]),
      allergens: JSON.stringify(["Sellerie"]),
      tags: JSON.stringify(["schnell", "ki-angepasst"]),
      ingredients: JSON.stringify(VALID_AI_RECIPE.ingredients),
      instructions: JSON.stringify(VALID_AI_RECIPE.instructions),
      isCustom: true,
      ownerProfileId: profileId,
      nutritionSource: "AI_ESTIMATE",
      generatedByAssistant: true,
    });
    expect(await res.json()).toMatchObject({ reply: expect.stringContaining("Neues Rezept gespeichert: Linsen-Curry mit Skyr"), intent: "TRANSFORM_RECIPE" });
    // Das Original bleibt unverändert.
    expect(await prisma.recipe.findUnique({ where: { id: original.id } })).toEqual(original);
  });

  it("ergänzt die Ernährungsform aus der Anweisung wie bisher", async () => {
    await createOriginal();
    llm.instruction = "vegan machen";

    expect((await askAssistant()).status).toBe(200);
    const [saved] = await transformedRecipes();
    expect(JSON.parse(saved.dietTypes)).toEqual(["VEGETARIAN", "VEGAN"]);
  });

  it("reine Größenänderungen bleiben deterministisch (ohne KI) und werden gespeichert", async () => {
    await createOriginal();
    llm.instruction = "halbe Portion";

    expect((await askAssistant()).status).toBe(200);
    expect(llm.transformCalls).toBe(0);
    const [saved] = await transformedRecipes();
    expect(saved).toMatchObject({ kcal: 300, proteinG: 15, carbsG: 35, fatG: 9, nutritionSource: "DATABASE" });
  });
});

describe("KI-umgeschriebenes Rezept: ungültige KI-Ausgabe wird nicht gespeichert (R5F-8)", () => {
  const { name: _name, ...withoutName } = VALID_AI_RECIPE;
  const { kcal: _kcal, ...withoutKcal } = VALID_AI_RECIPE;
  const { ingredients: _ingredients, ...withoutIngredients } = VALID_AI_RECIPE;

  it.each([
    ["Pflichtfeld name fehlt", withoutName],
    ["Pflichtfeld kcal fehlt", withoutKcal],
    ["Pflichtfeld ingredients fehlt", withoutIngredients],
    ["leerer Name", { ...VALID_AI_RECIPE, name: "   " }],
    ["Name zu lang", { ...VALID_AI_RECIPE, name: "x".repeat(121) }],
    ["kcal als Text", { ...VALID_AI_RECIPE, kcal: "712" }],
    ["Zutaten als Text statt Liste", { ...VALID_AI_RECIPE, ingredients: "200 g Linsen, 150 g Skyr" }],
    ["Zutat als Zahl", { ...VALID_AI_RECIPE, ingredients: ["200 g Linsen", 150] }],
    ["Zutat als Objekt", { ...VALID_AI_RECIPE, ingredients: [{ name: "Linsen", amount: 200 }] }],
    ["leere Zutatenliste", { ...VALID_AI_RECIPE, ingredients: [] }],
    ["leere Zutat", { ...VALID_AI_RECIPE, ingredients: ["200 g Linsen", "  "] }],
    ["Zubereitung mit Zahl", { ...VALID_AI_RECIPE, instructions: [1, 2] }],
    ["negative kcal", { ...VALID_AI_RECIPE, kcal: -50 }],
    ["kcal über der Obergrenze", { ...VALID_AI_RECIPE, kcal: 9000 }],
    ["Protein über der Obergrenze", { ...VALID_AI_RECIPE, proteinG: 800 }],
    ["negatives Fett", { ...VALID_AI_RECIPE, fatG: -1 }],
    ["kein Objekt", "Linsen-Curry"],
  ])("%s: 500 ohne Details, kein Rezept, keine Nachricht", async (_label, input) => {
    await createOriginal();
    llm.transformInput = input;

    await expectRejectedWithoutPersisting(await askAssistant(), AI_OUTPUT_INVALID);
  });

  it("keine strukturierte Antwort der KI: ebenso abgelehnt", async () => {
    await createOriginal();
    llm.transformAnswersWithText = true;

    await expectRejectedWithoutPersisting(await askAssistant(), AI_OUTPUT_INVALID);
  });

  it("die Antwort an den Client enthält keine Rohdaten der KI", async () => {
    await createOriginal();
    llm.transformInput = { ...VALID_AI_RECIPE, name: "GEHEIM-ROHDATEN", kcal: "viel" };

    const res = await askAssistant();

    expect(JSON.stringify(await res.json())).not.toMatch(/GEHEIM|viel|kcal/);
    // Auch das Server-Log nennt nur Feld und Regel, nicht den Wert.
    expect((consoleError.mock.calls.at(-1)?.[1] as Error).message).not.toMatch(/GEHEIM|viel/);
  });
});

describe("KI-umgeschriebenes Rezept: das fertige Rezept wird als Ganzes geprüft (R5F-8)", () => {
  it.each([
    ["Original ohne Mahlzeit-Slot", { mealSlots: "[]" }],
    ["Original mit leerem Tag", { tags: JSON.stringify(["schnell", " "]) }],
    ["zu viele Tags mit dem Hinweis-Tag", { tags: JSON.stringify(Array.from({ length: 20 }, (_, i) => `tag-${i}`)) }],
    ["Original ohne Ernährungsform", { dietTypes: "[]" }],
  ])("%s: abgelehnt, nichts gespeichert", async (_label, columns) => {
    await createOriginal(columns);

    await expectRejectedWithoutPersisting(await askAssistant(), PAYLOAD_INVALID);
  });

  it("auch die deterministische Skalierung: über den Grenzen des Schemas wird nichts gespeichert", async () => {
    await createOriginal({ kcal: 3000, proteinG: 150, carbsG: 300, fatG: 120 });
    llm.instruction = "doppelte Portion";

    await expectRejectedWithoutPersisting(await askAssistant(), PAYLOAD_INVALID);
    expect(llm.transformCalls).toBe(0);
  });

  it("ungültige Enum-Werte im Original (R5D-Prüfung beim Lesen): nichts gespeichert", async () => {
    await createOriginal({ mealSlots: JSON.stringify(["BRUNCH"]) });

    // Früher wurde die gespeicherte Spalte ungeprüft kopiert; jetzt wird sie geprüft gelesen.
    await expectRejectedWithoutPersisting(await askAssistant(), /Spalte "mealSlots" hat nicht die erwartete Form/);
  });
});
