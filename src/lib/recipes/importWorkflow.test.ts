import { describe, expect, it } from "vitest";
import type { QualityRecipeInput } from "./catalogQuality";
import { buildRecipe, buildRecipes, buildSeedCatalog } from "./data/build";
import {
  IMPORT_FIXTURE_INVALID_INGREDIENT,
  IMPORT_FIXTURE_MISSING_NUTRITION,
  IMPORT_FIXTURE_POSSIBLE_DUPLICATE,
  IMPORT_FIXTURE_RESOLVABLE,
  IMPORT_FIXTURE_UNKNOWN_FOOD,
} from "./data/importFixtures";
import {
  assessApprovalReadiness,
  canTransition,
  derivePublishTags,
  FOOD_ASSIGNMENT_STATUSES,
  importedRecipeSlugBase,
  importedRecipeSlugOptions,
  IMPORT_QUEUE_STATUSES,
  isImportQueueStatus,
  toPublishSeed,
  unacknowledgedDuplicateIds,
} from "./importWorkflow";
import { roundNutrition } from "./nutrition";
import {
  evaluateImportCandidate,
  normalizeImportedRecipe,
  runImportPipeline,
  toQualityRecipeInput,
  type ImportedRecipeCandidate,
  type RawImportedRecipe,
} from "./recipeImport";
import type { NutritionPerServing } from "./types";

const catalog = buildSeedCatalog();
const catalogRecipes: QualityRecipeInput[] = buildRecipes(catalog).map((r) => ({
  id: r.slug,
  slug: r.slug,
  name: r.name,
  servings: r.servings,
  structuredIngredients: r.ingredients.map((i) => ({ foodId: i.foodId, displayName: i.displayName, amount: i.amount, unit: i.unit, optional: i.optional })),
  freeTextIngredients: r.ingredientLines,
  tags: r.tags,
}));

function assess(raw: RawImportedRecipe) {
  return assessApprovalReadiness(runImportPipeline(raw, catalog, catalogRecipes), catalog);
}

function assessCandidate(candidate: ImportedRecipeCandidate, existing: QualityRecipeInput[] = catalogRecipes) {
  return assessApprovalReadiness(evaluateImportCandidate(candidate, catalog, existing), catalog);
}

function codes(raw: RawImportedRecipe): string[] {
  return assess(raw).blockers.map((b) => b.code);
}

// ---------------------------------------------------------------------------
// Statusmodell
// ---------------------------------------------------------------------------

describe("Statusübergänge", () => {
  const allowed = new Set([
    "pending_review>needs_changes",
    "pending_review>rejected",
    "pending_review>approved",
    "needs_changes>pending_review",
    "needs_changes>rejected",
    "approved>published",
    "approved>failed",
    "failed>needs_changes",
    "failed>rejected",
  ]);

  it.each(IMPORT_QUEUE_STATUSES.flatMap((from) => IMPORT_QUEUE_STATUSES.map((to) => [from, to] as const)))(
    "%s -> %s ist genau dann erlaubt, wenn es im Statusmodell steht",
    (from, to) => {
      expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
    },
  );

  it("rejected und published sind Endzustände", () => {
    for (const to of IMPORT_QUEUE_STATUSES) {
      expect(canTransition("rejected", to)).toBe(false);
      expect(canTransition("published", to)).toBe(false);
    }
  });

  it("erkennt gültige Statuswerte und weist andere ab", () => {
    expect(IMPORT_QUEUE_STATUSES.every(isImportQueueStatus)).toBe(true);
    for (const value of ["", "APPROVED", "ready_for_review", "deleted"]) expect(isImportQueueStatus(value)).toBe(false);
  });

  it("Food-Zuordnung ist nur vor der Freigabe erlaubt", () => {
    expect(FOOD_ASSIGNMENT_STATUSES).toEqual(["pending_review", "needs_changes"]);
  });
});

// ---------------------------------------------------------------------------
// Freigabe-Voraussetzungen
// ---------------------------------------------------------------------------

describe("assessApprovalReadiness", () => {
  it("Fixture A ist freigabefähig: alle Foods aufgelöst, Nährwerte vollständig, keine Duplikate", () => {
    expect(assess(IMPORT_FIXTURE_RESOLVABLE)).toEqual({ approvable: true, blockers: [], possibleDuplicateIds: [] });
  });

  it("unresolved Food blockiert und wird nie als gültiges Food behandelt", () => {
    const result = assess(IMPORT_FIXTURE_UNKNOWN_FOOD);
    expect(result.approvable).toBe(false);
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: "unresolved-food", ingredient: "20 g Dragon Fruit Powder" }));
  });

  it("fehlende Nährwerte blockieren (Eiersatz ohne Nährwerte), ebenso eine fehlende Mahlzeit", () => {
    expect(codes(IMPORT_FIXTURE_MISSING_NUTRITION)).toEqual(expect.arrayContaining(["incomplete-nutrition", "no-meal-slot"]));
  });

  it("eine aufgelöste Zutat ohne Menge blockiert (würde die Nährwerte zu niedrig ausweisen)", () => {
    const result = assess(IMPORT_FIXTURE_INVALID_INGREDIENT);
    expect(result.blockers).toEqual([expect.objectContaining({ code: "missing-amount", ingredient: "Haferflocken" })]);
  });

  it.each([
    ["fehlender Name", { ...IMPORT_FIXTURE_RESOLVABLE, name: "  " }],
    ["keine Zutaten", { ...IMPORT_FIXTURE_RESOLVABLE, ingredients: [] }],
  ])("%s -> validation-error", (_label, raw) => {
    expect(codes(raw)).toContain("validation-error");
  });

  it("fehlende Zubereitungszeit oder -schritte werden nicht erfunden, sondern blockieren", () => {
    expect(codes({ ...IMPORT_FIXTURE_RESOLVABLE, prepTimeMin: null })).toEqual(["missing-prep-time"]);
    expect(codes({ ...IMPORT_FIXTURE_RESOLVABLE, instructions: ["  "] })).toEqual(["missing-instructions"]);
  });

  it("eine Food-ID, die es im Katalog nicht (mehr) gibt, blockiert als ungültige Referenz", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const stale: ImportedRecipeCandidate = {
      ...candidate,
      ingredients: candidate.ingredients.map((i) => (i.resolvedFoodId === "banane" ? { ...i, resolvedFoodId: "geloeschtes-food" } : i)),
    };
    const blockers = assessCandidate(stale).blockers;
    expect(blockers).toContainEqual(expect.objectContaining({ code: "invalid-food-reference", ingredient: "1 Banane" }));
    expect(blockers.filter((b) => b.ingredient === "1 Banane")).toHaveLength(1);
  });

  it("ein exaktes Duplikat im Katalog blockiert", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const mirror: QualityRecipeInput = { ...toQualityRecipeInput(candidate), id: "mirror", slug: "mirror", name: "Spiegel" };
    expect(assessCandidate(candidate, [mirror]).blockers).toEqual([expect.objectContaining({ code: "exact-duplicate", message: expect.stringContaining("Spiegel") })]);
  });

  it("ein mögliches Duplikat blockiert nicht, wird aber zur Bestätigung ausgewiesen", () => {
    const result = assess(IMPORT_FIXTURE_POSSIBLE_DUPLICATE);
    expect(result.approvable).toBe(true);
    expect(result.possibleDuplicateIds).toContain("protein-pancakes-with-berries");
    expect(result.possibleDuplicateIds.every((id) => !id.startsWith("import:"))).toBe(true);
  });

  it("jeder Kapitel-18-Error macht einen Kandidaten nicht freigabefähig, auch ein künftig neuer Error-Code", () => {
    const evaluation = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    const withNewError = {
      ...evaluation,
      catalogQualityIssues: [
        ...evaluation.catalogQualityIssues,
        { recipeId: "x", recipeName: "x", code: "duplicate-ingredient" as const, severity: "error" as const, message: "neuer Fehler" },
      ],
    };
    expect(assessApprovalReadiness(withNewError, catalog).blockers).toEqual([{ code: "quality-error", message: "neuer Fehler" }]);

    for (const raw of [IMPORT_FIXTURE_UNKNOWN_FOOD, { ...IMPORT_FIXTURE_RESOLVABLE, name: "" }]) {
      const result = runImportPipeline(raw, catalog, catalogRecipes);
      const hasCh18Error = result.catalogQualityIssues.some((i) => i.severity === "error") || result.status === "validation_failed";
      expect(hasCh18Error).toBe(true);
      expect(assessApprovalReadiness(result, catalog).approvable).toBe(false);
    }
  });
});

describe("unacknowledgedDuplicateIds", () => {
  it("liefert nur mögliche Duplikate, die bei der Freigabe noch nicht bestätigt waren", () => {
    expect(unacknowledgedDuplicateIds(["a", "b", "c"], ["a", "c"])).toEqual(["b"]);
    expect(unacknowledgedDuplicateIds(["a"], ["a", "z"])).toEqual([]);
    expect(unacknowledgedDuplicateIds([], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Publish-Ableitung
// ---------------------------------------------------------------------------

const nutrition = (overrides: Partial<NutritionPerServing>): NutritionPerServing => ({
  kcal: 400,
  proteinG: 10,
  carbsG: 50,
  fatG: 10,
  fiberG: 2,
  sugarG: 5,
  saturatedFatG: 2,
  sodiumMg: 100,
  ...overrides,
});

describe("derivePublishTags", () => {
  it("die Ernährungsform kommt aus den Zutaten, nicht aus der Behauptung der Quelle", () => {
    expect(derivePublishTags(["vegan", "breakfast"], "vegetarian", nutrition({}))).toEqual({
      tags: ["vegetarian", "breakfast"],
      dropped: [{ tag: "vegan", reason: "Ernährungsform wird aus den Zutaten abgeleitet: vegetarian" }],
    });
  });

  it("unbekannte Tags entfallen mit Grund, bekannte werden normalisiert und dedupliziert", () => {
    expect(derivePublishTags(["Breakfast", "breakfast", "Schnell", "tiktok-viral"], "vegan", nutrition({}))).toEqual({
      tags: ["vegan", "breakfast", "quick"],
      dropped: [{ tag: "tiktok-viral", reason: "unbekannter Tag (nicht in der Tag-Registry)" }],
    });
  });

  it("nährwertbezogene Tags nur, wenn die bestehende Tag-Regel erfüllt ist", () => {
    expect(derivePublishTags(["high-protein"], "omnivore", nutrition({ proteinG: 30 })).tags).toEqual(["omnivore", "high-protein"]);
    expect(derivePublishTags(["high-protein"], "omnivore", nutrition({ proteinG: 10 })).dropped.map((d) => d.tag)).toEqual(["high-protein"]);
    expect(derivePublishTags(["keto"], "omnivore", nutrition({ carbsG: 60 })).tags).toEqual(["omnivore"]);
    expect(derivePublishTags(["keto"], "omnivore", nutrition({ kcal: 500, carbsG: 8, fiberG: 3, fatG: 40 })).tags).toEqual(["omnivore", "keto"]);
  });
});

describe("Slug", () => {
  it("leitet einen lesbaren Slug aus dem Namen ab", () => {
    expect(importedRecipeSlugBase("Skyr-Omelett mit Eiersatz")).toBe("skyr-omelett-mit-eiersatz");
    expect(importedRecipeSlugBase("  Müsli & Beeren!  ")).toBe("muesli-beeren");
    expect(importedRecipeSlugBase("!!!")).toBe("importiertes-rezept");
  });

  it("bietet für Kollisionen einen deterministischen Suffix aus der Kandidaten-ID", () => {
    expect(importedRecipeSlugOptions("Protein Pancakes", "cmABCDEF1234XYZ9")).toEqual(["protein-pancakes", "protein-pancakes-1234xyz9"]);
  });
});

describe("toPublishSeed", () => {
  it("baut über buildRecipe dieselben Nährwerte, Allergene und Ernährungsform wie die Kapitel-20-Bewertung", () => {
    const evaluation = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    const seed = toPublishSeed(evaluation.candidate, "protein-pancakes", ["vegetarian", "breakfast"]);
    expect(seed.ingredients).toEqual([
      { food: "skyr", name: "Skyr", amount: 100, unit: "g", optional: false },
      { food: "haferflocken", name: "Haferflocken", amount: 50, unit: "g", optional: false },
      { food: "banane", name: "Banane", amount: 1, unit: "piece", optional: false },
    ]);

    const built = buildRecipe(seed, catalog);
    expect(built.nutrition).toEqual(roundNutrition(evaluation.nutrition.nutrition.perServing));
    expect(built.allergens).toEqual(evaluation.profile.allergens);
    expect(built.dietClass).toBe(evaluation.profile.dietClass);
    expect(built.prepTimeMin).toBe(10);
    expect(built.totalTimeMin).toBe(10);
  });

  it("verweigert unaufgelöste Zutaten statt still ein falsches Food einzusetzen", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_UNKNOWN_FOOD, catalog);
    expect(() => toPublishSeed(candidate, "x", ["vegetarian"])).toThrow(/nicht aufgelöst/);
  });
});
