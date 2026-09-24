import { describe, expect, it } from "vitest";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import type { QualityRecipeInput } from "./catalogQuality";
import {
  IMPORT_FIXTURE_INVALID_INGREDIENT,
  IMPORT_FIXTURE_MISSING_NUTRITION,
  IMPORT_FIXTURE_POSSIBLE_DUPLICATE,
  IMPORT_FIXTURE_RESOLVABLE,
  IMPORT_FIXTURE_UNKNOWN_FOOD,
} from "./data/importFixtures";
import {
  IMPORT_STATUSES,
  checkImportCandidateAgainstCatalog,
  createMockExternalRecipeSource,
  formatNormalizedIngredient,
  importCandidateId,
  normalizeImportedIngredient,
  normalizeImportedRecipe,
  parseRawIngredientText,
  runImportPipeline,
  toQualityRecipeInput,
  toRecipeReviewItem,
  validateImportCandidate,
  type RawImportedRecipe,
} from "./recipeImport";

const catalog = buildSeedCatalog();

/**
 * Die echten Katalog-Rezepte als `QualityRecipeInput[]` (dieselbe Form wie
 * `recipeService.loadCatalogQualityInputs()` sie aus der DB liefern würde) - für Duplicate-/
 * Workflow-Tests gegen den ECHTEN Bestand, nicht gegen erfundene Fixture-Rezepte.
 */
const catalogRecipes: QualityRecipeInput[] = buildRecipes(catalog).map((r) => ({
  id: r.slug,
  slug: r.slug,
  name: r.name,
  servings: r.servings,
  structuredIngredients: r.ingredients.map((i) => ({
    foodId: i.foodId,
    displayName: i.displayName,
    amount: i.amount,
    unit: i.unit,
    optional: i.optional,
    ...(i.gramsOverride !== undefined ? { gramsOverride: i.gramsOverride } : {}),
  })),
  freeTextIngredients: r.ingredientLines,
  tags: r.tags,
}));

const PANCAKES_WITH_BERRIES = catalogRecipes.find((r) => r.slug === "protein-pancakes-with-berries")!;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

describe("parseRawIngredientText", () => {
  it.each([
    ["100 g Skyr", 100, "g", "Skyr"],
    ["50 g oats", 50, "g", "oats"],
    ["0.5 TL Backpulver", 0.5, "tl", "Backpulver"],
    ["0,5 TL Zucker", 0.5, "tl", "Zucker"],
    ["2 EL Honig", 2, "el", "Honig"],
    ["3 Scheiben Brot", 3, "slice", "Brot"],
    ["1 Dose Kichererbsen", 1, "can", "Kichererbsen"],
    ["1 Prise Salz", 1, "pinch", "Salz"],
    ["1 kg Reis", 1000, "g", "Reis"],
    ["1 l Wasser", 1000, "ml", "Wasser"],
  ])("erkennt Menge/Einheit/Label aus %s", (input, amount, unit, label) => {
    expect(parseRawIngredientText(input)).toEqual({ amount, unit, label });
  });

  it("ein bloßer Zähler ohne Einheitswort gilt als Stück, z.B. '1 Banane'", () => {
    expect(parseRawIngredientText("1 Banane")).toEqual({ amount: 1, unit: "piece", label: "Banane" });
  });

  it("ein unbekanntes Einheitswort wird NIE geraten: Menge bleibt, Einheit bleibt null, das Wort bleibt im Label", () => {
    expect(parseRawIngredientText("2 cups Greek yogurt")).toEqual({ amount: 2, unit: null, label: "cups Greek yogurt" });
  });

  it("ohne erkennbare Menge bleiben Menge und Einheit null, der Text bleibt vollständig im Label", () => {
    expect(parseRawIngredientText("Salz nach Geschmack")).toEqual({ amount: null, unit: null, label: "Salz nach Geschmack" });
  });
});

describe("normalizeImportedIngredient: Food Resolution", () => {
  it("löst ein Food über einen bekannten Alias auf ('oats' -> Haferflocken)", () => {
    const result = normalizeImportedIngredient({ originalText: "50 g oats" }, catalog);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.resolvedFoodId).toBe("haferflocken");
    expect(result.resolvedFoodName).toBe("Haferflocken");
    expect(result.amount).toBe(50);
    expect(result.unit).toBe("g");
  });

  it("löst ein Food über den exakten Namen auf ('Skyr')", () => {
    const result = normalizeImportedIngredient({ originalText: "100 g Skyr" }, catalog);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.resolvedFoodId).toBe("skyr");
  });

  it("ein unbekanntes Food bleibt 'unresolved', OHNE dass irgendein Food erraten wird", () => {
    const result = normalizeImportedIngredient({ originalText: "20 g Dragon Fruit Powder" }, catalog);
    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.resolvedFoodId).toBeNull();
    expect(result.resolvedFoodName).toBeNull();
  });

  it("der Rohtext (originalText) bleibt unverändert erhalten, auch nach erfolgreicher Normalisierung", () => {
    const result = normalizeImportedIngredient({ originalText: "  100 g Skyr  " }, catalog);
    expect(result.originalText).toBe("  100 g Skyr  ");
  });

  it("strukturierte Hints (labelHint ohne amountHint) liefern ein aufgelöstes Food ohne erkannte Menge", () => {
    const result = normalizeImportedIngredient({ originalText: "Haferflocken (Menge unklar)", labelHint: "Haferflocken" }, catalog);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.resolvedFoodId).toBe("haferflocken");
    expect(result.amount).toBeNull();
    expect(result.unit).toBeNull();
  });

  it("ein 'optional' im Rohtext markiert die Zutat als optional", () => {
    const result = normalizeImportedIngredient({ originalText: "1 Prise Salz, optional" }, catalog);
    expect(result.optional).toBe(true);
  });

  it("ohne 'optional' im Rohtext ist die Zutat nicht optional", () => {
    const result = normalizeImportedIngredient({ originalText: "100 g Skyr" }, catalog);
    expect(result.optional).toBe(false);
  });
});

describe("normalizeImportedRecipe", () => {
  it("normalisiert alle Zutaten einer Fixture und behält Rohtexte zusätzlich gesammelt (rawIngredientLines)", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    expect(candidate.name).toBe("Protein Pancakes");
    expect(candidate.ingredients).toHaveLength(3);
    expect(candidate.rawIngredientLines).toEqual(["100 g Skyr", "50 g oats", "1 Banane"]);
    expect(candidate.ingredients.every((i) => i.resolutionStatus === "resolved")).toBe(true);
  });
});

describe("formatNormalizedIngredient", () => {
  it("formatiert eine aufgelöste Zutat lesbar mit dem kanonischen Food-Namen", () => {
    const ingredient = normalizeImportedIngredient({ originalText: "50 g oats" }, catalog);
    expect(formatNormalizedIngredient(ingredient)).toBe("50 g Haferflocken");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateImportCandidate", () => {
  it("ein vollständig auflösbares Rezept hat keine Validation-Errors und keine Warnings", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    expect(validateImportCandidate(candidate, catalog)).toEqual([]);
  });

  it("fehlender Name -> error 'missing-name'", () => {
    const candidate = normalizeImportedRecipe({ ...IMPORT_FIXTURE_RESOLVABLE, name: "   " }, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing-name", severity: "error" }));
  });

  it("keine Zutaten -> error 'no-ingredients'", () => {
    const candidate = normalizeImportedRecipe({ ...IMPORT_FIXTURE_RESOLVABLE, ingredients: [] }, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "no-ingredients", severity: "error" }));
  });

  it("unbekanntes Food -> warning 'unresolved-food', mit betroffener Zutat", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_UNKNOWN_FOOD, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(
      expect.objectContaining({ code: "unresolved-food", severity: "warning", ingredient: "20 g Dragon Fruit Powder" }),
    );
  });

  it("aufgelöstes Food ohne Nährwertdaten -> warning 'missing-nutrition'", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_MISSING_NUTRITION, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing-nutrition", severity: "warning" }));
  });

  it("aufgelöstes Food ohne erkennbare Menge/Einheit -> warning 'invalid-amount-or-unit', OHNE 'unresolved-food'", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_INVALID_INGREDIENT, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "invalid-amount-or-unit", severity: "warning" }));
    expect(issues.some((i) => i.code === "unresolved-food")).toBe(false);
  });

  it("weder externe ID noch URL -> warning 'missing-source-identifier'", () => {
    const raw: RawImportedRecipe = { ...IMPORT_FIXTURE_RESOLVABLE, source: { type: "manual", label: "Manuelle Eingabe" } };
    const candidate = normalizeImportedRecipe(raw, catalog);
    const issues = validateImportCandidate(candidate, catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing-source-identifier", severity: "warning" }));
  });
});

// ---------------------------------------------------------------------------
// Duplicate Detection (Kapitel-18-Logik, unverändert, nur über toQualityRecipeInput angebunden)
// ---------------------------------------------------------------------------

describe("checkImportCandidateAgainstCatalog", () => {
  it("erkennt ein exaktes Duplikat: identische Zutaten/Mengen wie ein bestehendes Katalog-Rezept", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const mirror: QualityRecipeInput = toQualityRecipeInput(candidate);
    const existingIdenticalRecipe: QualityRecipeInput = { ...mirror, id: "existing-mirror", slug: "existing-mirror", name: "Bereits im Katalog" };
    const result = checkImportCandidateAgainstCatalog(candidate, [existingIdenticalRecipe], catalog);
    expect(result.exactDuplicates).toHaveLength(1);
    expect(result.exactDuplicates[0].recipes.map((r) => r.id).sort()).toEqual(["existing-mirror", importCandidateId(candidate)].sort());
  });

  it("exaktes Duplikat wird auch bei umgekehrter Zutaten-Reihenfolge erkannt", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const mirror = toQualityRecipeInput(candidate);
    const reordered: QualityRecipeInput = {
      ...mirror,
      id: "existing-reordered",
      slug: "existing-reordered",
      name: "Reihenfolge vertauscht",
      structuredIngredients: [...mirror.structuredIngredients].reverse(),
    };
    const result = checkImportCandidateAgainstCatalog(candidate, [reordered], catalog);
    expect(result.exactDuplicates).toHaveLength(1);
  });

  it("erkennt einen möglichen Duplicate-Kandidaten gegen den ECHTEN Katalog (Protein Pancakes with Blueberries ~ ... with Berries)", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_POSSIBLE_DUPLICATE, catalog);
    const result = checkImportCandidateAgainstCatalog(candidate, catalogRecipes, catalog);
    expect(result.exactDuplicates).toHaveLength(0);
    expect(result.possibleDuplicates.length).toBeGreaterThan(0);
    const involvesPancakes = result.possibleDuplicates.some(
      (pair) => pair.recipeA.id === PANCAKES_WITH_BERRIES.id || pair.recipeB.id === PANCAKES_WITH_BERRIES.id,
    );
    expect(involvesPancakes).toBe(true);
  });

  it("ein unähnliches Rezept ergibt weder exaktes noch mögliches Duplikat gegen den echten Katalog", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const result = checkImportCandidateAgainstCatalog(candidate, catalogRecipes, catalog);
    expect(result.exactDuplicates).toEqual([]);
    expect(result.possibleDuplicates).toEqual([]);
  });

  it("unterschiedliche Food-IDs bei sonst gleicher Struktur ergeben KEIN exaktes Duplikat", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_RESOLVABLE, catalog);
    const mirror = toQualityRecipeInput(candidate);
    const differentFood: QualityRecipeInput = {
      ...mirror,
      id: "existing-different-food",
      slug: "existing-different-food",
      name: "Andere Zutat, gleiche Struktur",
      structuredIngredients: mirror.structuredIngredients.map((row) => (row.foodId === "skyr" ? { ...row, foodId: "naturjoghurt" } : row)),
    };
    const result = checkImportCandidateAgainstCatalog(candidate, [differentFood], catalog);
    expect(result.exactDuplicates).toEqual([]);
  });

  it("ein Kandidat mit unresolved Food ist nicht belastbar genug für einen Duplicate-Vergleich (kein Crash, einfach kein Treffer)", () => {
    const candidate = normalizeImportedRecipe(IMPORT_FIXTURE_UNKNOWN_FOOD, catalog);
    const result = checkImportCandidateAgainstCatalog(candidate, catalogRecipes, catalog);
    expect(result.exactDuplicates).toEqual([]);
    expect(result.possibleDuplicates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Workflow / Status-Übergänge
// ---------------------------------------------------------------------------

describe("runImportPipeline: Statusmodell", () => {
  it("raw -> normalized -> validation_failed bei fehlendem Namen", () => {
    const raw: RawImportedRecipe = { ...IMPORT_FIXTURE_RESOLVABLE, name: "" };
    const result = runImportPipeline(raw, catalog, catalogRecipes);
    expect(result.status).toBe("validation_failed");
    expect(result.statusHistory).toEqual(["raw", "normalized", "validation_failed"]);
    expect(result.duplicates).toEqual({ exactDuplicates: [], possibleDuplicates: [] });
    expect(result.catalogQualityIssues).toEqual([]);
  });

  it("raw -> normalized -> ready_for_review bei validem, nicht-duplikathaftem Rezept", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    expect(result.status).toBe("ready_for_review");
    expect(result.statusHistory).toEqual(["raw", "normalized", "ready_for_review"]);
  });

  it("raw -> normalized -> duplicate_review bei möglichem Duplicate gegen den echten Katalog", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_POSSIBLE_DUPLICATE, catalog, catalogRecipes);
    expect(result.status).toBe("duplicate_review");
    expect(result.statusHistory).toEqual(["raw", "normalized", "duplicate_review"]);
  });

  it("unresolved Food oder fehlende Nährwerte blockieren die Pipeline NICHT (nur Warnings, kein Error)", () => {
    const unknownFood = runImportPipeline(IMPORT_FIXTURE_UNKNOWN_FOOD, catalog, catalogRecipes);
    const missingNutrition = runImportPipeline(IMPORT_FIXTURE_MISSING_NUTRITION, catalog, catalogRecipes);
    expect(unknownFood.status).not.toBe("validation_failed");
    expect(missingNutrition.status).not.toBe("validation_failed");
  });

  it.each([
    ["A - resolvable", IMPORT_FIXTURE_RESOLVABLE],
    ["B - unknown food", IMPORT_FIXTURE_UNKNOWN_FOOD],
    ["C - possible duplicate", IMPORT_FIXTURE_POSSIBLE_DUPLICATE],
    ["D - missing nutrition", IMPORT_FIXTURE_MISSING_NUTRITION],
    ["E - invalid ingredient", IMPORT_FIXTURE_INVALID_INGREDIENT],
  ])("Fixture %s: die Pipeline liefert NIE 'approved' oder 'rejected' - das ist eine spätere menschliche Entscheidung", (_label, fixture) => {
    const result = runImportPipeline(fixture, catalog, catalogRecipes);
    expect(result.status).not.toBe("approved");
    expect(result.status).not.toBe("rejected");
    expect(result.statusHistory).not.toContain("approved");
    expect(result.statusHistory).not.toContain("rejected");
  });

  it("IMPORT_STATUSES enthält genau die sieben spezifizierten Werte, in dieser Reihenfolge", () => {
    expect(IMPORT_STATUSES).toEqual(["raw", "normalized", "validation_failed", "ready_for_review", "duplicate_review", "approved", "rejected"]);
  });
});

// ---------------------------------------------------------------------------
// Review-Integration (recipeReview.ts, Kapitel 19 - dieselben Bausteine)
// ---------------------------------------------------------------------------

describe("toRecipeReviewItem", () => {
  it("ein möglicher Duplicate-Kandidat landet in der Kategorie 'duplicate_possible'", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_POSSIBLE_DUPLICATE, catalog, catalogRecipes);
    const item = toRecipeReviewItem(result);
    expect(item.category).toBe("duplicate_possible");
    expect(item.duplicateCandidates.length).toBeGreaterThan(0);
    expect(item.duplicateCandidates.some((c) => c.recipe.id === PANCAKES_WITH_BERRIES.id)).toBe(true);
  });

  it("ein validation_failed-Kandidat landet in der Kategorie 'insufficient_data' mit einem konkreten Grund", () => {
    const raw: RawImportedRecipe = { ...IMPORT_FIXTURE_RESOLVABLE, name: "" };
    const result = runImportPipeline(raw, catalog, catalogRecipes);
    const item = toRecipeReviewItem(result);
    expect(item.category).toBe("insufficient_data");
    expect(item.insufficientDataReason).toContain("keinen Namen");
  });

  it("ein sonst sauberer Kandidat hat dennoch mindestens die 'missing-slug'-Quality-Issue (Kapitel 18: unveränderte Wiederverwendung, ein Import hat naturgemäß noch keinen Slug) -> Kategorie 'quality_issue', nicht 'clean'", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    const item = toRecipeReviewItem(result);
    expect(item.category).toBe("quality_issue");
    expect(result.catalogQualityIssues).toContainEqual(expect.objectContaining({ code: "missing-slug" }));
  });

  it("recipeId eines Review-Items für einen Import trägt das Präfix 'import:' - kollidiert nie mit echten Katalog-IDs", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    const item = toRecipeReviewItem(result);
    expect(item.recipeId).toMatch(/^import:/);
    expect(item.slug).toBeNull();
  });

  it("der Status eines Review-Items ist immer 'pending' - keine automatische Freigabe (Kapitel 19: reiner UI-Ausgangszustand)", () => {
    const result = runImportPipeline(IMPORT_FIXTURE_RESOLVABLE, catalog, catalogRecipes);
    expect(toRecipeReviewItem(result).status).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Mock-Quelle
// ---------------------------------------------------------------------------

describe("createMockExternalRecipeSource", () => {
  it("liefert exakt die übergebenen Rezepte unverändert zurück, ohne Netzwerk/IO", async () => {
    const source = createMockExternalRecipeSource("Test Feed", [IMPORT_FIXTURE_RESOLVABLE, IMPORT_FIXTURE_UNKNOWN_FOOD]);
    const recipes = await source.fetchRecipes();
    expect(recipes).toEqual([IMPORT_FIXTURE_RESOLVABLE, IMPORT_FIXTURE_UNKNOWN_FOOD]);
    expect(source.label).toBe("Test Feed");
  });
});
