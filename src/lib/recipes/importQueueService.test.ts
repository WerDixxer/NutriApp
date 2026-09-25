import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSchema, removeIsolatedDatabase, seedFoodCatalog } from "@/test/isolatedDatabase";
import { FoodCatalog } from "./catalog";
import { buildRecipes, buildSeedCatalog, recipeIngredientRowData, recipeRowData } from "./data/build";
import {
  IMPORT_FIXTURE_INVALID_INGREDIENT,
  IMPORT_FIXTURE_MISSING_NUTRITION,
  IMPORT_FIXTURE_POSSIBLE_DUPLICATE,
  IMPORT_FIXTURE_RESOLVABLE,
  IMPORT_FIXTURE_UNKNOWN_FOOD,
} from "./data/importFixtures";
import type { RawImportedRecipe } from "./recipeImport";
import type { CatalogFood } from "./types";

/**
 * Integrationstests gegen eine ISOLIERTE, frisch angelegte SQLite-Datenbank im OS-Temp-Verzeichnis
 * (Schema per `prisma db push`, Foods/Rezepte aus den Seed-Daten). Die echte prisma/dev.db wird nie
 * geöffnet: `../db` ist auf diese Testdatenbank umgelenkt, und der Setup (src/test/isolatedDatabase.ts)
 * bricht ab, falls die URL nicht im Temp-Verzeichnis liegt. Echte Transaktionen, Unique-Indizes und
 * Foreign Keys - das ist nötig, um Idempotenz, parallele Requests und Rollback belastbar zu prüfen.
 */
const testDb = await vi.hoisted(async () => {
  const { createIsolatedDatabaseLocation } = await import("@/test/isolatedDatabase");
  return createIsolatedDatabaseLocation("vyn-import-queue-");
});

vi.mock("../db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url }) };
});

const { prisma } = await import("../db");
const service = await import("./importQueueService");

const reviewer = { userId: "reviewer-1" };
const seedCatalog = buildSeedCatalog();
const seedSlugs = buildRecipes(seedCatalog).map((r) => r.slug);

async function seedTestCatalog() {
  await seedFoodCatalog(prisma);
  for (const recipe of buildRecipes(seedCatalog)) {
    await prisma.recipe.create({
      data: {
        ...recipeRowData(recipe),
        slug: recipe.slug,
        sourceType: recipe.source.type,
        ingredientRows: { create: recipe.ingredients.map((ingredient, position) => recipeIngredientRowData(ingredient, position, ingredient.foodId)) },
      },
    });
  }
}

beforeAll(async () => {
  pushSchema(testDb);
  await seedTestCatalog();
}, 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(testDb);
});

beforeEach(async () => {
  await prisma.recipeImportEvent.deleteMany();
  await prisma.recipeImportCandidate.deleteMany();
  // SQL "slug NOT IN (...)" trifft NULL-Slugs nicht, deshalb explizit mit abräumen.
  await prisma.recipe.deleteMany({ where: { OR: [{ slug: null }, { slug: { notIn: seedSlugs } }] } });
});

async function enqueue(raw: RawImportedRecipe, context?: Awaited<ReturnType<typeof service.loadImportReviewContext>>): Promise<string> {
  const ctx = context ?? (await service.loadImportReviewContext());
  const result = await service.enqueueImportedRecipe(raw, ctx.catalog, reviewer);
  if (!result.ok) throw new Error(`enqueue fehlgeschlagen: ${result.error}`);
  return result.candidateId;
}

async function candidateRow(id: string) {
  return prisma.recipeImportCandidate.findUniqueOrThrow({ where: { id } });
}

async function eventActions(id: string): Promise<string[]> {
  const events = await prisma.recipeImportEvent.findMany({ where: { candidateId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return events.map((event) => event.action);
}

async function externalRecipeCount(): Promise<number> {
  return prisma.recipe.count({ where: { sourceType: "external" } });
}

/** Legt ein Katalog-Rezept mit exakt denselben Zutaten wie der gespeicherte Kandidat an (exaktes Duplikat). */
async function createCatalogMirrorOf(candidateId: string, slug: string, extraIngredients: { foodId: string; amount: number; unit: string }[] = []) {
  const row = await candidateRow(candidateId);
  const ingredients = JSON.parse(row.ingredients) as { resolvedFoodId: string; amount: number | null; unit: string | null; optional: boolean; resolvedFoodName: string }[];
  const rows = [
    ...ingredients.map((i) => ({ foodId: i.resolvedFoodId, amount: i.amount, unit: i.unit, optional: i.optional, displayName: i.resolvedFoodName })),
    ...extraIngredients.map((i) => ({ ...i, optional: false, displayName: i.foodId })),
  ];
  return prisma.recipe.create({
    data: {
      name: slug === "mirror-exact" ? "Gespiegeltes Rezept" : "Protein Pancakes Deluxe",
      description: "",
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      prepTimeMin: 5,
      mealSlots: "[]",
      dietTypes: "[]",
      allergens: "[]",
      ingredients: "[]",
      instructions: "[]",
      tags: JSON.stringify(["breakfast", "high-protein"]),
      slug,
      ingredientRows: { create: rows.map((r, position) => ({ ...r, position })) },
    },
  });
}

// ---------------------------------------------------------------------------
// Persistenz
// ---------------------------------------------------------------------------

describe("enqueueImportedRecipe: Persistenz", () => {
  it("legt einen Kandidaten als pending_review an und schreibt den Import in den Audit Trail", async () => {
    const id = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    const row = await candidateRow(id);
    expect(row.status).toBe("pending_review");
    expect(row.name).toBe("Protein Pancakes");
    expect(row.sourceType).toBe("mock");
    expect(row.sourceProvider).toBe("Mock Recipe Feed");
    expect(row.sourceExternalId).toBe("mock-a-resolvable");
    expect(row.sourceUrl).toBe("https://example.invalid/recipes/a");
    expect(row.publishedRecipeId).toBeNull();
    expect(await eventActions(id)).toEqual(["imported"]);
  });

  it("hält Rohdaten und normalisierte Daten getrennt: der Rohtext bleibt unverändert neben der Interpretation", async () => {
    const id = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    const detail = await service.getImportCandidateDetail(id);
    const raw = detail!.stored.rawPayload as RawImportedRecipe;
    expect(raw.ingredients.map((i) => i.originalText)).toEqual(["100 g Skyr", "50 g oats", "1 Banane"]);
    expect(raw.rawSourceMetadata).toEqual({ feedEntryId: "a-resolvable" });

    const oats = detail!.stored.candidate.ingredients[1];
    expect(oats.originalText).toBe("50 g oats");
    expect(oats.resolvedFoodId).toBe("haferflocken");
    expect(oats.resolvedFoodName).toBe("Haferflocken");
    expect(oats.manualAssignment).toBeNull();
  });

  it("verhindert eine doppelte Queue-Anlage bei gleicher Quellen-ID", async () => {
    const first = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    const context = await service.loadImportReviewContext();
    const second = await service.enqueueImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, context.catalog, reviewer);
    expect(second).toEqual({ ok: false, error: "DUPLICATE_SOURCE", existingCandidateId: first });
    expect(await prisma.recipeImportCandidate.count()).toBe(1);
  });

  it("legt auch bei parallelen Imports derselben Quellen-ID nur einen Kandidaten an", async () => {
    const context = await service.loadImportReviewContext();
    const results = await Promise.all([1, 2, 3].map(() => service.enqueueImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, context.catalog, reviewer)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.recipeImportCandidate.count()).toBe(1);
  });

  it("dedupliziert ohne externe ID NICHT über den Namen", async () => {
    const withoutId: RawImportedRecipe = { ...IMPORT_FIXTURE_RESOLVABLE, source: { type: "manual", label: "Manuelle Eingabe" } };
    await enqueue(withoutId);
    await enqueue(withoutId);
    expect(await prisma.recipeImportCandidate.count()).toBe(2);
  });

  it("speichert auch unvollständige Kandidaten, markiert sie aber als nicht freigabefähig", async () => {
    const noName = await enqueue({ ...IMPORT_FIXTURE_RESOLVABLE, name: "", source: { ...IMPORT_FIXTURE_RESOLVABLE.source, externalId: "no-name" } });
    const unknownFood = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const context = await service.loadImportReviewContext();
    const overview = await service.listImportQueue(context, null);

    for (const id of [noName, unknownFood]) {
      const item = overview.items.find((i) => i.id === id)!;
      expect(item.status).toBe("pending_review");
      expect(item.approvable).toBe(false);
      expect(item.blockerCount).toBeGreaterThan(0);
    }
    expect(overview.items.find((i) => i.id === unknownFood)!.unresolvedFoods).toEqual(["20 g Dragon Fruit Powder"]);
  });

  it("listImportQueue filtert nach Status und zählt je Status", async () => {
    const a = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    await service.markNeedsChanges(a, reviewer, null);
    const context = await service.loadImportReviewContext();

    const needsChanges = await service.listImportQueue(context, "needs_changes");
    expect(needsChanges.items.map((i) => i.id)).toEqual([a]);
    expect(needsChanges.countsByStatus.needs_changes).toBe(1);
    expect(needsChanges.countsByStatus.pending_review).toBe(1);
    expect(needsChanges.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Workflow und Audit Trail
// ---------------------------------------------------------------------------

describe("Statusübergänge", () => {
  it("pending_review -> needs_changes -> pending_review, jeweils mit Audit-Eintrag und Notiz", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    expect(await service.markNeedsChanges(id, reviewer, "  Dragon Fruit Powder zuordnen  ")).toEqual({ ok: true });
    expect((await candidateRow(id)).status).toBe("needs_changes");
    expect(await service.resubmitForReview(id, reviewer, null)).toEqual({ ok: true });
    expect((await candidateRow(id)).status).toBe("pending_review");

    const events = await prisma.recipeImportEvent.findMany({ where: { candidateId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(events.map((e) => [e.action, e.fromStatus, e.toStatus])).toEqual([
      ["imported", null, "pending_review"],
      ["needs_changes", "pending_review", "needs_changes"],
      ["resubmitted", "needs_changes", "pending_review"],
    ]);
    expect(events[1].note).toBe("Dragon Fruit Powder zuordnen");
    expect(events[1].actorUserId).toBe("reviewer-1");
  });

  it("Reject braucht einen Grund und ist endgültig", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    expect(await service.rejectCandidate(id, reviewer, "   ")).toEqual({ ok: false, error: "NOTE_REQUIRED" });
    expect((await candidateRow(id)).status).toBe("pending_review");

    expect(await service.rejectCandidate(id, reviewer, "Zutat nicht im Katalog verfügbar")).toEqual({ ok: true });
    expect((await candidateRow(id)).status).toBe("rejected");

    const context = await service.loadImportReviewContext();
    expect(await service.rejectCandidate(id, reviewer, "nochmal")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await service.markNeedsChanges(id, reviewer)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false })).toEqual({ ok: false, error: "INVALID_TRANSITION" });
  });

  it("weist unzulässige Übergänge ab, ohne etwas zu schreiben", async () => {
    const id = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    expect(await service.resubmitForReview(id, reviewer)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    const context = await service.loadImportReviewContext();
    await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false });
    expect(await service.markNeedsChanges(id, reviewer)).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await service.rejectCandidate(id, reviewer, "zu spät")).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(await eventActions(id)).toEqual(["imported", "approved"]);
  });

  it("unbekannte/manipulierte IDs liefern NOT_FOUND statt eines Fehlers oder einer Änderung", async () => {
    const context = await service.loadImportReviewContext();
    for (const id of ["does-not-exist", "' OR 1=1 --", ""]) {
      expect(await service.markNeedsChanges(id, reviewer)).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(await service.rejectCandidate(id, reviewer, "Grund")).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "x" })).toEqual({ ok: false, error: "NOT_FOUND" });
      expect(await service.publishCandidate(id, reviewer, context)).toEqual({ ok: false, error: "NOT_FOUND" });
    }
    expect(await prisma.recipeImportEvent.count()).toBe(0);
  });

  it("parallele, widersprüchliche Entscheidungen: genau eine gewinnt, die andere wird abgewiesen", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const results = await Promise.all([service.markNeedsChanges(id, reviewer, "a"), service.rejectCandidate(id, reviewer, "b")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false });
    const decisions = (await eventActions(id)).filter((a) => a !== "imported");
    expect(decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Food Resolution im Review
// ---------------------------------------------------------------------------

describe("assignIngredientFood", () => {
  it("ordnet eine unaufgelöste Zutat einem existierenden Food zu, dokumentiert das und bewertet neu", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const context = await service.loadImportReviewContext();
    const before = service.reviewStoredCandidate((await service.getImportCandidateDetail(id))!.stored, context);
    expect(before.assessment.blockers.map((b) => b.code)).toContain("unresolved-food");

    const result = await service.assignIngredientFood(id, reviewer, context, { ingredientIndex: 1, foodId: "beeren", note: "Pulver aus Beeren" });
    expect(result.ok).toBe(true);
    expect(result.review!.assessment.blockers.map((b) => b.code)).not.toContain("unresolved-food");
    expect(result.review!.evaluation.nutrition.unresolvedIngredientCount).toBe(0);

    const stored = (await service.getImportCandidateDetail(id))!.stored;
    const assigned = stored.candidate.ingredients[1];
    expect(assigned.originalText).toBe("20 g Dragon Fruit Powder");
    expect(assigned.resolvedFoodId).toBe("beeren");
    expect(assigned.amount).toBe(20);
    expect(assigned.manualAssignment).toMatchObject({ actorUserId: "reviewer-1" });

    const event = await prisma.recipeImportEvent.findFirstOrThrow({ where: { candidateId: id, action: "food_assigned" } });
    expect(JSON.parse(event.details!)).toEqual({ ingredientIndex: 1, originalText: "20 g Dragon Fruit Powder", foodId: "beeren", foodName: "Beeren" });
    expect(event.note).toBe("Pulver aus Beeren");
    expect(await prisma.ingredient.count({ where: { name: { contains: "Dragon" } } })).toBe(0);
  });

  it("akzeptiert nur existierende Food-IDs und legt nie ein Food an", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const context = await service.loadImportReviewContext();
    const foodsBefore = await prisma.ingredient.count();
    expect(await service.assignIngredientFood(id, reviewer, context, { ingredientIndex: 1, foodId: "dragon-fruit-powder" })).toEqual({
      ok: false,
      error: "FOOD_NOT_FOUND",
    });
    expect(await prisma.ingredient.count()).toBe(foodsBefore);
    expect((await service.getImportCandidateDetail(id))!.stored.candidate.ingredients[1].resolutionStatus).toBe("unresolved");
  });

  it("ändert keine bereits aufgelöste Zutat und keine ungültigen Indizes", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const context = await service.loadImportReviewContext();
    expect(await service.assignIngredientFood(id, reviewer, context, { ingredientIndex: 0, foodId: "beeren" })).toEqual({
      ok: false,
      error: "INGREDIENT_ALREADY_RESOLVED",
    });
    for (const ingredientIndex of [5, -1, 1.5]) {
      expect(await service.assignIngredientFood(id, reviewer, context, { ingredientIndex, foodId: "beeren" })).toEqual({ ok: false, error: "INGREDIENT_NOT_FOUND" });
    }
  });

  it("ist nach der Freigabe nicht mehr erlaubt", async () => {
    const id = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    const context = await service.loadImportReviewContext();
    await service.assignIngredientFood(id, reviewer, context, { ingredientIndex: 1, foodId: "beeren" });
    expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false })).toEqual({ ok: true });
    expect(await service.assignIngredientFood(id, reviewer, context, { ingredientIndex: 0, foodId: "beeren" })).toEqual({
      ok: false,
      error: "ASSIGNMENT_NOT_ALLOWED",
    });
  });
});

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

describe("approveCandidate", () => {
  it("gibt einen vollständigen Kandidaten frei, erstellt dabei aber KEIN Rezept", async () => {
    const id = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    const context = await service.loadImportReviewContext();
    const recipesBefore = await prisma.recipe.count();
    expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false, note: "passt" })).toEqual({ ok: true });

    const row = await candidateRow(id);
    expect(row.status).toBe("approved");
    expect(row.publishedRecipeId).toBeNull();
    expect(JSON.parse(row.acknowledgedDuplicateIds)).toEqual([]);
    expect(await prisma.recipe.count()).toBe(recipesBefore);
  });

  const blockedCases: [string, RawImportedRecipe, string][] = [
    ["fehlender Name", { ...IMPORT_FIXTURE_RESOLVABLE, name: "", source: { ...IMPORT_FIXTURE_RESOLVABLE.source, externalId: "x-name" } }, "validation-error"],
    ["keine Zutaten", { ...IMPORT_FIXTURE_RESOLVABLE, ingredients: [], source: { ...IMPORT_FIXTURE_RESOLVABLE.source, externalId: "x-ingr" } }, "validation-error"],
    ["unresolved Food", IMPORT_FIXTURE_UNKNOWN_FOOD, "unresolved-food"],
    ["fehlende Nährwerte", IMPORT_FIXTURE_MISSING_NUTRITION, "incomplete-nutrition"],
    ["fehlende Menge", IMPORT_FIXTURE_INVALID_INGREDIENT, "missing-amount"],
  ];
  it.each(blockedCases)("blockiert bei %s mit konkretem Grund", async (_label, raw, blockerCode) => {
    const id = await enqueue(raw);
    const context = await service.loadImportReviewContext();
    const result = await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "trotzdem" });
    expect(result).toMatchObject({ ok: false, error: "NOT_APPROVABLE" });
    if (result.ok) throw new Error("unreachable");
    expect(result.blockers!.map((b) => b.code)).toContain(blockerCode);
    expect((await candidateRow(id)).status).toBe("pending_review");
  });

  it("mögliches Duplikat: Approve nur mit ausdrücklicher Bestätigung UND Begründung, bestätigte IDs werden gespeichert", async () => {
    const id = await enqueue(IMPORT_FIXTURE_POSSIBLE_DUPLICATE);
    const context = await service.loadImportReviewContext();
    const pancakes = await prisma.recipe.findUniqueOrThrow({ where: { slug: "protein-pancakes-with-berries" } });

    expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false, note: "ok" })).toEqual({
      ok: false,
      error: "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED",
    });
    expect(await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "  " })).toEqual({
      ok: false,
      error: "DUPLICATE_ACKNOWLEDGEMENT_REQUIRED",
    });
    expect(
      await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "Blaubeer-Variante ist bewusst eigenständig" }),
    ).toEqual({ ok: true });

    const row = await candidateRow(id);
    expect(JSON.parse(row.acknowledgedDuplicateIds)).toContain(pancakes.id);
    const event = await prisma.recipeImportEvent.findFirstOrThrow({ where: { candidateId: id, action: "approved" } });
    expect(event.note).toBe("Blaubeer-Variante ist bewusst eigenständig");
  });

  it("exaktes Duplikat im Katalog blockiert die Freigabe", async () => {
    const id = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    await createCatalogMirrorOf(id, "mirror-exact");
    const context = await service.loadImportReviewContext();
    const result = await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: true, note: "egal" });
    expect(result).toMatchObject({ ok: false, error: "NOT_APPROVABLE" });
    if (result.ok) throw new Error("unreachable");
    expect(result.blockers!.map((b) => b.code)).toEqual(["exact-duplicate"]);
  });
});

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

async function approvedCandidate(raw: RawImportedRecipe = IMPORT_FIXTURE_RESOLVABLE): Promise<string> {
  const id = await enqueue(raw);
  const context = await service.loadImportReviewContext();
  const approved = await service.approveCandidate(id, reviewer, context, { acknowledgeDuplicates: false });
  if (!approved.ok) throw new Error(`approve fehlgeschlagen: ${approved.error}`);
  return id;
}

describe("publishCandidate", () => {
  it("erstellt Recipe + RecipeIngredients, speichert die Recipe-ID und setzt erst danach published", async () => {
    const id = await approvedCandidate();
    const context = await service.loadImportReviewContext();
    const result = await service.publishCandidate(id, reviewer, context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    const recipe = await prisma.recipe.findUniqueOrThrow({ where: { id: result.recipeId! }, include: { ingredientRows: { orderBy: { position: "asc" } } } });
    expect(recipe.slug).toBe("protein-pancakes");
    expect(recipe.sourceType).toBe("external");
    expect(recipe.sourceProvider).toBe("Mock Recipe Feed");
    expect(recipe.sourceExternalId).toBe("mock-a-resolvable");
    expect(recipe.nutritionSource).toBe("COMPUTED");
    expect(recipe.prepTimeMin).toBe(10);
    expect(recipe.cookTimeMin).toBeNull();
    expect(recipe.ingredientRows.map((r) => [r.foodId, r.amount, r.unit])).toEqual([
      ["skyr", 100, "g"],
      ["haferflocken", 50, "g"],
      ["banane", 1, "piece"],
    ]);
    // 100 g Skyr (63) + 50 g Haferflocken (186) + 1 Banane à 120 g (114) = 363 kcal
    expect(recipe.kcal).toBe(363);
    // "high-protein" erfüllt die bestehende Tag-Regel nicht (19,1 g, 21 % der Energie) und entfällt.
    expect(JSON.parse(recipe.tags)).toEqual(["vegetarian", "breakfast"]);
    expect(JSON.parse(recipe.mealSlots)).toEqual(["BREAKFAST"]);

    const row = await candidateRow(id);
    expect(row.status).toBe("published");
    expect(row.publishedRecipeId).toBe(recipe.id);
    const published = await prisma.recipeImportEvent.findFirstOrThrow({ where: { candidateId: id, action: "published" } });
    expect(published.recipeId).toBe(recipe.id);
    expect(published.actorUserId).toBe("reviewer-1");
    expect(JSON.parse(published.details!).droppedTags).toEqual([
      { tag: "high-protein", reason: "die berechneten Nährwerte erfüllen die Regel für diesen Tag nicht" },
    ]);
  });

  it("verweigert den Publish ohne Freigabe und nach einem Reject", async () => {
    const pending = await enqueue(IMPORT_FIXTURE_RESOLVABLE);
    const rejected = await enqueue(IMPORT_FIXTURE_UNKNOWN_FOOD);
    await service.rejectCandidate(rejected, reviewer, "nicht passend");
    const context = await service.loadImportReviewContext();

    expect(await service.publishCandidate(pending, reviewer, context)).toEqual({ ok: false, error: "NOT_APPROVED" });
    expect(await service.publishCandidate(rejected, reviewer, context)).toEqual({ ok: false, error: "NOT_APPROVED" });
    expect(await externalRecipeCount()).toBe(0);
  });

  it("ist idempotent: ein zweiter Publish erstellt kein zweites Rezept", async () => {
    const id = await approvedCandidate();
    const context = await service.loadImportReviewContext();
    const first = await service.publishCandidate(id, reviewer, context);
    const second = await service.publishCandidate(id, reviewer, context);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "ALREADY_PUBLISHED", recipeId: first.ok ? first.recipeId : undefined });
    expect(await externalRecipeCount()).toBe(1);
  });

  it.each([
    ["mit externer Quellen-ID (Claim + Quellen-Prüfung)", IMPORT_FIXTURE_RESOLVABLE],
    ["ohne externe Quellen-ID (einziger Schutz: bedingter Claim)", { ...IMPORT_FIXTURE_RESOLVABLE, source: { type: "manual", label: "Manuelle Eingabe" } } as RawImportedRecipe],
  ])("parallele Publish-Requests erzeugen genau ein Rezept, %s", async (_label, raw) => {
    const id = await approvedCandidate(raw);
    const context = await service.loadImportReviewContext();
    const results = await Promise.all([1, 2, 3, 4].map(() => service.publishCandidate(id, reviewer, context)));

    const winner = results.find((r) => r.ok);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "ALREADY_PUBLISHED", recipeId: winner?.ok ? winner.recipeId : undefined })),
    );
    expect(await externalRecipeCount()).toBe(1);
    const row = await candidateRow(id);
    expect(row.status).toBe("published");
    expect(await prisma.recipeImportEvent.count({ where: { candidateId: id, action: "published" } })).toBe(1);
    expect(await prisma.recipeImportEvent.count({ where: { candidateId: id, action: "publish_error" } })).toBe(0);
  });

  it("rollt bei einem Fehler mitten in der Transaktion alles zurück (kein halbes Rezept, Status bleibt approved)", async () => {
    // Ein Food, das der übergebene Katalog kennt, die Datenbank aber nicht: das Rezept wird angelegt,
    // die Zutatenzeile scheitert danach am Foreign Key - die ganze Transaktion muss zurückrollen.
    const ghost: CatalogFood = {
      id: "ghost-food",
      slug: "ghost-food",
      name: "Ghost Food",
      category: "other",
      dietClass: "vegan",
      allergens: [],
      aliases: [],
      nutrition: { kcal: 100, proteinG: 5, carbsG: 10, fatG: 2, fiberG: 1, sugarG: 1, saturatedFatG: 0.5, sodiumMg: 10 },
    };
    const base = await service.loadImportReviewContext();
    const staleContext = { ...base, catalog: new FoodCatalog([...base.catalog.all(), ghost], []) };
    const raw: RawImportedRecipe = {
      ...IMPORT_FIXTURE_RESOLVABLE,
      name: "Ghost Bowl",
      source: { ...IMPORT_FIXTURE_RESOLVABLE.source, externalId: "ghost-1" },
      ingredients: [{ originalText: "100 g Ghost Food" }, { originalText: "50 g oats" }],
    };
    const id = await enqueue(raw, staleContext);
    expect(await service.approveCandidate(id, reviewer, staleContext, { acknowledgeDuplicates: false })).toEqual({ ok: true });
    const recipesBefore = await prisma.recipe.count();
    const ingredientRowsBefore = await prisma.recipeIngredient.count();

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await service.publishCandidate(id, reviewer, staleContext);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("Transaktion zurückgerollt"), expect.objectContaining({ code: "P2003" }));
    errorLog.mockRestore();
    expect(result).toEqual({ ok: false, error: "PUBLISH_FAILED" });
    expect(await prisma.recipe.count()).toBe(recipesBefore);
    expect(await prisma.recipeIngredient.count()).toBe(ingredientRowsBefore);
    expect(await prisma.recipe.count({ where: { slug: "ghost-bowl" } })).toBe(0);

    const row = await candidateRow(id);
    expect(row.status).toBe("approved");
    expect(row.publishedRecipeId).toBeNull();
    expect(await eventActions(id)).toEqual(["imported", "approved", "publish_error"]);
  });

  it("erstellt keinen zweiten Katalog-Eintrag, wenn die Quelle bereits im Katalog steht", async () => {
    const id = await approvedCandidate();
    const existing = await prisma.recipe.create({
      data: {
        name: "Bereits importiert",
        description: "",
        kcal: 0,
        proteinG: 0,
        carbsG: 0,
        fatG: 0,
        prepTimeMin: 5,
        mealSlots: "[]",
        dietTypes: "[]",
        allergens: "[]",
        ingredients: "[]",
        instructions: "[]",
        sourceType: "external",
        sourceProvider: "Mock Recipe Feed",
        sourceExternalId: "mock-a-resolvable",
      },
    });
    const context = await service.loadImportReviewContext();
    expect(await service.publishCandidate(id, reviewer, context)).toEqual({ ok: false, error: "ALREADY_IN_CATALOG", recipeId: existing.id });
    expect(await externalRecipeCount()).toBe(1);
    expect((await candidateRow(id)).status).toBe("approved");
  });

  it("prüft Duplikate unmittelbar vor dem Publish erneut: ein inzwischen exaktes Duplikat -> failed, kein Rezept", async () => {
    const id = await approvedCandidate();
    await createCatalogMirrorOf(id, "mirror-exact");
    const context = await service.loadImportReviewContext();
    const result = await service.publishCandidate(id, reviewer, context);
    expect(result).toMatchObject({ ok: false, error: "PUBLISH_BLOCKED" });
    expect(await externalRecipeCount()).toBe(0);

    expect((await candidateRow(id)).status).toBe("failed");
    const blocked = await prisma.recipeImportEvent.findFirstOrThrow({ where: { candidateId: id, action: "publish_blocked" } });
    expect(JSON.parse(blocked.details!).blockers.map((b: { code: string }) => b.code)).toEqual(["exact-duplicate"]);
    // failed ist kein Endzustand: zurück in die Überarbeitung
    expect(await service.markNeedsChanges(id, reviewer, "Duplikat klären")).toEqual({ ok: true });
  });

  it("blockiert den Publish, wenn seit der Freigabe ein neues mögliches Duplikat hinzugekommen ist", async () => {
    const id = await approvedCandidate();
    await createCatalogMirrorOf(id, "similar-deluxe", [{ foodId: "milch", amount: 100, unit: "ml" }]);
    const context = await service.loadImportReviewContext();
    const result = await service.publishCandidate(id, reviewer, context);
    expect(result).toMatchObject({ ok: false, error: "PUBLISH_BLOCKED" });
    if (result.ok) throw new Error("unreachable");
    expect(result.blockers!.map((b) => b.code)).toEqual(["unacknowledged-duplicate"]);
    expect(await externalRecipeCount()).toBe(0);
  });

  it("ein veröffentlichter Kandidat vergleicht sich nicht mit seinem eigenen Katalog-Rezept", async () => {
    const id = await approvedCandidate();
    let context = await service.loadImportReviewContext();
    await service.publishCandidate(id, reviewer, context);
    context = await service.loadImportReviewContext();
    const review = service.reviewStoredCandidate((await service.getImportCandidateDetail(id))!.stored, context);
    expect(review.evaluation.duplicates.exactDuplicates).toEqual([]);
  });
});

describe("Audit Trail", () => {
  it("dokumentiert den vollständigen Weg bis zum Publish mit Status, Reviewer und Recipe-ID - ohne E-Mail", async () => {
    const id = await approvedCandidate();
    const context = await service.loadImportReviewContext();
    const published = await service.publishCandidate(id, reviewer, context);
    const detail = await service.getImportCandidateDetail(id);

    expect(detail!.events.map((e) => [e.action, e.fromStatus, e.toStatus, e.actorUserId])).toEqual([
      ["imported", null, "pending_review", "reviewer-1"],
      ["approved", "pending_review", "approved", "reviewer-1"],
      ["published", "approved", "published", "reviewer-1"],
    ]);
    expect(detail!.events[2].recipeId).toBe(published.ok ? published.recipeId : null);
    const rawEvents = await prisma.recipeImportEvent.findMany({ where: { candidateId: id } });
    expect(JSON.stringify(rawEvents)).not.toMatch(/@/);
  });
});
