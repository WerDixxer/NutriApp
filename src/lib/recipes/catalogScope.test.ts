import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSchema, removeIsolatedDatabase, seedFoodCatalog } from "@/test/isolatedDatabase";
import { IMPORT_FIXTURE_RESOLVABLE } from "./data/importFixtures";

/**
 * F-08 (R2): globale Katalog-Werkzeuge (Quality-Report, Review-Queue, Import-Duplikatprüfung)
 * sehen nur Rezepte des globalen Katalogs, nie private eigene Rezepte von Nutzern. Gegen eine
 * isolierte SQLite-Datenbank; die echte prisma/dev.db wird nie geöffnet.
 */
const db = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-r2-scope-");
});
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: db.url }) };
});

const { prisma } = await import("@/lib/db");
const { loadCatalogQualityInputs, loadFoodCatalog } = await import("./recipeService");
const { buildRecipeCatalogQualityReport } = await import("./catalogQuality");
const { buildRecipeReviewQueue } = await import("./recipeReview");
const importQueue = await import("./importQueueService");

const reviewer = { userId: "reviewer-r2" };

/** Dieselben drei Zutaten, die Import-Fixture A nach der Normalisierung hat (100 g Skyr, 50 g Haferflocken, 1 Banane). */
const FIXTURE_A_ROWS = [
  { position: 0, foodId: "skyr", displayName: "Skyr", amount: 100, unit: "g" },
  { position: 1, foodId: "haferflocken", displayName: "Haferflocken", amount: 50, unit: "g" },
  { position: 2, foodId: "banane", displayName: "Banane", amount: 1, unit: "piece" },
];

beforeAll(async () => {
  pushSchema(db);
  await seedFoodCatalog(prisma);
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

beforeEach(async () => {
  await prisma.recipeImportEvent.deleteMany();
  await prisma.recipeImportCandidate.deleteMany();
  await prisma.recipe.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.user.deleteMany();
});

function recipeData(name: string) {
  return {
    name,
    description: "",
    kcal: 400,
    proteinG: 20,
    carbsG: 50,
    fatG: 10,
    prepTimeMin: 10,
    mealSlots: JSON.stringify(["BREAKFAST"]),
    dietTypes: JSON.stringify(["OMNIVORE", "VEGETARIAN"]),
    allergens: JSON.stringify(["milch", "gluten"]),
    ingredients: JSON.stringify(["100 g Skyr", "50 g Haferflocken", "1 Banane"]),
    instructions: JSON.stringify(["Zubereiten."]),
  };
}

async function privateRecipe(name: string, withStructuredRows: boolean) {
  const user = await prisma.user.create({ data: { name: "Privatperson" } });
  const profile = await prisma.profile.create({
    data: { userId: user.id, age: 30, sex: "FEMALE", heightCm: 165, weightKg: 60, activityLevel: "LIGHT", goal: "MAINTAIN", dietType: "OMNIVORE" },
  });
  return prisma.recipe.create({
    data: {
      ...recipeData(name),
      isCustom: true,
      sourceType: "user",
      ownerProfileId: profile.id,
      ...(withStructuredRows ? { ingredientRows: { create: FIXTURE_A_ROWS } } : {}),
    },
  });
}

async function globalCatalogRecipe(name: string, slug: string) {
  return prisma.recipe.create({ data: { ...recipeData(name), slug, ingredientRows: { create: FIXTURE_A_ROWS } } });
}

async function legacyGlobalRecipe(name: string) {
  return prisma.recipe.create({ data: recipeData(name) });
}

async function enqueueFixtureA(): Promise<string> {
  const context = await importQueue.loadImportReviewContext();
  const result = await importQueue.enqueueImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, context.catalog, reviewer);
  if (!result.ok) throw new Error(result.error);
  return result.candidateId;
}

describe("loadCatalogQualityInputs: Scope des globalen Katalogs", () => {
  it("Fall A: globale Katalog- und Altrezepte sind enthalten, Fall B: private eigene Rezepte nicht", async () => {
    const catalogRecipe = await globalCatalogRecipe("Skyr-Frühstück", "skyr-fruehstueck");
    const legacy = await legacyGlobalRecipe("Altrezept Porridge");
    const secret = await privateRecipe("Omas geheime Pancakes", true);

    const ids = (await loadCatalogQualityInputs()).map((r) => r.id);
    expect(ids).toContain(catalogRecipe.id);
    expect(ids).toContain(legacy.id);
    expect(ids).not.toContain(secret.id);
  });

  it("Fall B: die Review-Queue zeigt keine privaten Rezeptnamen", async () => {
    await globalCatalogRecipe("Skyr-Frühstück", "skyr-fruehstueck");
    await privateRecipe("Omas geheime Pancakes", false);

    const inputs = await loadCatalogQualityInputs();
    const catalog = await loadFoodCatalog();
    const queue = buildRecipeReviewQueue(inputs, buildRecipeCatalogQualityReport(inputs, catalog));
    expect(queue.items.map((i) => i.recipeName)).toEqual(["Skyr-Frühstück"]);
  });
});

describe("Import-Duplikatprüfung", () => {
  it("Fall C: ein strukturgleiches privates Rezept mit gleichem Namen blockiert den globalen Import nicht", async () => {
    await privateRecipe("Protein Pancakes", true);
    const id = await enqueueFixtureA();
    const context = await importQueue.loadImportReviewContext();

    const review = importQueue.reviewStoredCandidate((await importQueue.getImportCandidateDetail(id))!.stored, context);
    expect(review.evaluation.duplicates).toEqual({ exactDuplicates: [], possibleDuplicates: [] });
    expect(await importQueue.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false })).toEqual({ ok: true });
  });

  it("Fall A: ein strukturgleiches GLOBALES Katalogrezept blockiert weiterhin als exaktes Duplikat", async () => {
    await globalCatalogRecipe("Skyr-Frühstück", "skyr-fruehstueck");
    const id = await enqueueFixtureA();
    const context = await importQueue.loadImportReviewContext();

    const result = await importQueue.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "egal" });
    expect(result).toMatchObject({ ok: false, error: "NOT_APPROVABLE" });
    if (result.ok) throw new Error("unreachable");
    expect(result.blockers!.map((b) => b.code)).toEqual(["exact-duplicate"]);
  });
});
