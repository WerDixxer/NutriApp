import { describe, expect, it } from "vitest";
import { FoodCatalog } from "./catalog";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import {
  auditRecipeCatalogQuality,
  buildRecipeCatalogQualityReport,
  computeRecipeFingerprint,
  findExactRecipeDuplicates,
  findInsufficientDataRecipes,
  findPossibleRecipeDuplicates,
  type QualityIngredientRow,
  type QualityRecipeInput,
} from "./catalogQuality";
import type { RecipeUnit } from "./types";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

/** Baut eine rohe RecipeIngredient-Zeile wie sie recipeService.ts liefern würde. */
function row(foodId: string | null, amount: number | null, unit: RecipeUnit | null, opts: Partial<QualityIngredientRow> = {}): QualityIngredientRow {
  return {
    foodId,
    displayName: foodId ? (catalog.get(foodId)?.name ?? foodId) : "Unbekannt",
    amount,
    unit,
    optional: false,
    ...opts,
  };
}

function recipe(overrides: Partial<QualityRecipeInput> & { id: string; name: string }): QualityRecipeInput {
  return { slug: null, servings: 1, structuredIngredients: [], freeTextIngredients: [], tags: [], ...overrides };
}

/** Die echten strukturierten Zutaten eines Seed-Rezepts als rohe Zeilen (für realistische Fixtures). */
function seedRows(slug: string): QualityIngredientRow[] {
  const r = built.find((x) => x.slug === slug)!;
  return r.ingredients.map((i) => row(i.foodId, i.amount, i.unit, { optional: i.optional, ...(i.gramsOverride !== undefined ? { gramsOverride: i.gramsOverride } : {}) }));
}
function seedRecipe(slug: string, overrides: Partial<QualityRecipeInput> = {}): QualityRecipeInput {
  const r = built.find((x) => x.slug === slug)!;
  return recipe({ id: slug, slug, name: r.name, servings: r.servings, structuredIngredients: seedRows(slug), tags: r.tags, ...overrides });
}

const PANCAKES = "protein-pancakes-with-berries"; // 40g Haferflocken, 1 Ei, 100g Skyr, 50ml Milch, 0.5TL Backpulver, 100g Beeren, Süße(optional)

describe("computeRecipeFingerprint: Grundlage", () => {
  it("nutzt Food-IDs, nicht Zutatentexte: unterschiedliche displayName-Schreibweisen ändern nichts", () => {
    const a = [row("skyr", 100, "g", { displayName: "Skyr" })];
    const b = [row("skyr", 100, "g", { displayName: "SKYR (Magerstufe)" })];
    expect(computeRecipeFingerprint(a, catalog).signature).toBe(computeRecipeFingerprint(b, catalog).signature);
  });

  it("die Ingredient-Reihenfolge ist irrelevant", () => {
    const rows = seedRows(PANCAKES);
    const shuffled = [...rows].reverse();
    expect(computeRecipeFingerprint(rows, catalog).signature).toBe(computeRecipeFingerprint(shuffled, catalog).signature);
  });

  it("unterschiedliche Mengen ergeben unterschiedliche Signaturen", () => {
    const rows = seedRows(PANCAKES);
    const more = rows.map((r) => (r.foodId === "skyr" ? { ...r, amount: 150 } : r));
    expect(computeRecipeFingerprint(rows, catalog).signature).not.toBe(computeRecipeFingerprint(more, catalog).signature);
  });

  it("unterschiedliche Einheiten ergeben unterschiedliche Signaturen, auch bei gleicher Zahl", () => {
    const a = [row("milch", 50, "ml")];
    const b = [row("milch", 50, "g")];
    expect(computeRecipeFingerprint(a, catalog).signature).not.toBe(computeRecipeFingerprint(b, catalog).signature);
  });

  it("ohne strukturierte Zeilen ist der Fingerprint nicht belastbar (structured: false, leere Signatur)", () => {
    expect(computeRecipeFingerprint([], catalog)).toEqual({ structured: false, signature: "", readableIngredients: [], foodIds: new Set() });
  });

  it("eine fehlende oder unbekannte Food-Referenz macht den gesamten Fingerprint unbelastbar", () => {
    const missing = [row("skyr", 100, "g"), row(null, 40, "g")];
    const unknown = [row("skyr", 100, "g"), row("does-not-exist", 40, "g")];
    expect(computeRecipeFingerprint(missing, catalog).structured).toBe(false);
    expect(computeRecipeFingerprint(unknown, catalog).structured).toBe(false);
  });

  it("readableIngredients ist sortiert und nutzt den kanonischen Food-Namen", () => {
    const fp = computeRecipeFingerprint([row("skyr", 100, "g"), row("haferflocken", 40, "g")], catalog);
    expect(fp.readableIngredients).toEqual(["100 g Skyr", "40 g Haferflocken"].sort((a, b) => a.localeCompare(b, "de")));
  });
});

describe("findExactRecipeDuplicates", () => {
  it("gleiche Ingredients, gleiche Mengen -> exaktes Duplikat", () => {
    const a = seedRecipe(PANCAKES, { id: "a" });
    const b = recipe({ id: "b", name: "Kopie der Pancakes", structuredIngredients: seedRows(PANCAKES) });
    const groups = findExactRecipeDuplicates([a, b], catalog);
    expect(groups).toHaveLength(1);
    expect(groups[0].recipes.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("unterschiedliche Ingredient-Reihenfolge wird trotzdem als Duplikat erkannt", () => {
    const a = recipe({ id: "a", name: "A", structuredIngredients: seedRows(PANCAKES) });
    const b = recipe({ id: "b", name: "B", structuredIngredients: [...seedRows(PANCAKES)].reverse() });
    expect(findExactRecipeDuplicates([a, b], catalog)).toHaveLength(1);
  });

  it("unterschiedliche Namen, aber identische Struktur -> trotzdem Duplikat (Name fließt nicht in die Signatur ein)", () => {
    const a = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: seedRows(PANCAKES) });
    const b = recipe({ id: "b", name: "Frühstücks-Pfannkuchen Deluxe", structuredIngredients: seedRows(PANCAKES) });
    const groups = findExactRecipeDuplicates([a, b], catalog);
    expect(groups).toHaveLength(1);
    expect(groups[0].recipes.map((r) => r.name).sort()).toEqual(["Frühstücks-Pfannkuchen Deluxe", "Protein Pancakes"]);
  });

  it("unterschiedliche IDs mit gleicher Struktur werden fachlich korrekt als eine Gruppe geführt (auch mit drei Rezepten)", () => {
    const rows = seedRows(PANCAKES);
    const recipes = ["x1", "x2", "x3"].map((id) => recipe({ id, name: `Variante ${id}`, structuredIngredients: rows }));
    const groups = findExactRecipeDuplicates(recipes, catalog);
    expect(groups).toHaveLength(1);
    expect(groups[0].recipes.map((r) => r.id).sort()).toEqual(["x1", "x2", "x3"]);
  });

  it("liefert Recipe-IDs, Namen, Fingerprint und gemeinsame Merkmale (nachvollziehbares Ergebnis)", () => {
    const a = recipe({ id: "a", name: "A", structuredIngredients: [row("skyr", 100, "g")] });
    const b = recipe({ id: "b", name: "B", structuredIngredients: [row("skyr", 100, "g")] });
    const [group] = findExactRecipeDuplicates([a, b], catalog);
    expect(group).toMatchObject({ status: "exact", signature: expect.any(String), sharedFeatures: ["100 g Skyr"] });
    expect(group.recipes).toEqual(expect.arrayContaining([{ id: "a", slug: null, name: "A" }, { id: "b", slug: null, name: "B" }]));
  });

  it("keine falschen Duplikate: unterschiedliche Struktur bleibt getrennt", () => {
    const a = recipe({ id: "a", name: "A", structuredIngredients: [row("skyr", 100, "g")] });
    const b = recipe({ id: "b", name: "B", structuredIngredients: [row("skyr", 150, "g")] });
    expect(findExactRecipeDuplicates([a, b], catalog)).toEqual([]);
  });

  it("Alt-/unvollständige Rezepte können nie exakte Duplikate sein, auch wenn ihr Freitext identisch aussieht", () => {
    const legacyA = recipe({ id: "a", name: "Omas Eintopf", freeTextIngredients: ["200 g Linsen", "1 Zwiebel"] });
    const legacyB = recipe({ id: "b", name: "Omas Eintopf (Kopie)", freeTextIngredients: ["200 g Linsen", "1 Zwiebel"] });
    expect(findExactRecipeDuplicates([legacyA, legacyB], catalog)).toEqual([]);
  });

  it("die 60 echten Katalog-Rezepte enthalten keine unbeabsichtigten exakten Duplikate", () => {
    const inputs = built.map((r) => seedRecipe(r.slug));
    expect(findExactRecipeDuplicates(inputs, catalog)).toEqual([]);
  });
});

describe("findPossibleRecipeDuplicates", () => {
  it("gleicher Kern + kleine Zusatzzutat -> possible mit hohem Score", () => {
    const base = seedRows(PANCAKES).filter((r) => r.foodId !== "beeren");
    const a = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: base, tags: ["breakfast", "vegetarian"] });
    const b = recipe({ id: "b", name: "Protein Pancakes with Berries", structuredIngredients: seedRows(PANCAKES), tags: ["breakfast", "vegetarian"] });
    const [pair] = findPossibleRecipeDuplicates([a, b], catalog);
    expect(pair).toBeDefined();
    expect(pair.status).toBe("possible");
    expect(pair.score).toBeGreaterThan(0.6);
    expect(pair.ingredientOverlap).toBeGreaterThan(0.7);
    expect(pair.sharedFoodIds).toEqual(expect.arrayContaining(["haferflocken", "skyr"]));
  });

  it("leicht veränderter Name allein löst ohne Zutaten-Überlappung nichts aus", () => {
    const a = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: [row("skyr", 100, "g"), row("haferflocken", 40, "g")] });
    const b = recipe({ id: "b", name: "Protein Pancakes Deluxe", structuredIngredients: [row("avocado", 80, "g"), row("toast", 60, "g")] });
    expect(findPossibleRecipeDuplicates([a, b], catalog)).toEqual([]);
  });

  it("leicht unterschiedliche Mengen bei sonst gleichen Zutaten -> possible, aber nicht exact", () => {
    const rowsA = seedRows(PANCAKES);
    const rowsB = rowsA.map((r) => (r.foodId === "skyr" ? { ...r, amount: 120 } : r));
    const a = recipe({ id: "a", name: "Pancakes A", structuredIngredients: rowsA, tags: ["breakfast"] });
    const b = recipe({ id: "b", name: "Pancakes B", structuredIngredients: rowsB, tags: ["breakfast"] });
    expect(findExactRecipeDuplicates([a, b], catalog)).toEqual([]);
    const [pair] = findPossibleRecipeDuplicates([a, b], catalog);
    expect(pair.ingredientOverlap).toBe(1);
    expect(pair.score).toBeGreaterThanOrEqual(0.6);
  });

  it("deutlich unterschiedliche Ingredients -> kein Duplicate", () => {
    const a = recipe({ id: "a", name: "Salat", structuredIngredients: [row("thunfisch", 100, "g"), row("tomaten", 80, "g")] });
    const b = recipe({ id: "b", name: "Curry", structuredIngredients: [row("kichererbsen", 150, "g"), row("reis", 100, "g"), row("kokosmilch", 50, "ml", { optional: true })] });
    expect(findPossibleRecipeDuplicates([a, b], catalog)).toEqual([]);
  });

  it("Chicken vs. Tofu wird nicht automatisch als Duplicate behandelt, auch bei sonst identischem Rezept", () => {
    const chicken = recipe({
      id: "chicken",
      name: "Chicken Rice Bowl",
      structuredIngredients: [row("haehnchenbrust", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g")],
      tags: ["omnivore", "lunch"],
    });
    const tofu = recipe({
      id: "tofu",
      name: "Tofu Rice Bowl",
      structuredIngredients: [row("tofu", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g")],
      tags: ["vegan", "lunch"],
    });
    expect(findExactRecipeDuplicates([chicken, tofu], catalog)).toEqual([]);
    const pairs = findPossibleRecipeDuplicates([chicken, tofu], catalog);
    // Egal ob es als "possible" auftaucht: es darf nie als exact gelten, und falls doch gelistet,
    // muss die unterschiedliche Ernährungsform klar ausgewiesen sein - nie eine stille Gleichsetzung.
    for (const pair of pairs) expect(pair.dietClassDiffers).toBe(true);
  });

  it("der Diet-Class-Abschlag entscheidet an der Schwelle: ein sonst grenzwertiges Chicken/Tofu-Bowl-Paar bleibt unter POSSIBLE_THRESHOLD", () => {
    // 3 gemeinsame Zutaten (reis, brokkoli, teriyaki-sauce), je 1 eigenes Protein: Overlap 3/5 = 0.6,
    // Namensüberschneidung und Tag-Überlappung liegen so, dass der Score ohne den Abschlag über der
    // Schwelle läge - genau der Fall, den der Abschlag abfangen soll (siehe Auftrag Abschnitt 5).
    const chicken = recipe({
      id: "chicken",
      name: "Chicken Rice Bowl",
      structuredIngredients: [row("haehnchenbrust", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g"), row("teriyaki-sauce", 20, "g")],
      tags: ["omnivore", "lunch", "dinner"],
    });
    const tofu = recipe({
      id: "tofu",
      name: "Tofu Rice Bowl",
      structuredIngredients: [row("tofu", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g"), row("teriyaki-sauce", 20, "g")],
      tags: ["vegan", "lunch", "dinner"],
    });
    expect(findPossibleRecipeDuplicates([chicken, tofu], catalog)).toEqual([]);
  });

  it("vegetarisch vs. Fleisch und vegan vs. nicht-vegan werden über dietClassDiffers markiert, nie verschwiegen", () => {
    const meat = recipe({ id: "m", name: "Bowl A", structuredIngredients: [row("rindfleisch", 120, "g"), row("reis", 100, "g"), row("paprika", 50, "g")], tags: ["omnivore"] });
    const veggie = recipe({ id: "v", name: "Bowl B", structuredIngredients: [row("kichererbsen", 120, "g"), row("reis", 100, "g"), row("paprika", 50, "g")], tags: ["vegan"] });
    const pairs = findPossibleRecipeDuplicates([meat, veggie], catalog);
    for (const pair of pairs) expect(pair.dietClassDiffers).toBe(true);
  });

  it("Paare mit identischer Signatur erscheinen nicht bei 'possible' (gehören zu 'exact')", () => {
    const a = recipe({ id: "a", name: "A", structuredIngredients: seedRows(PANCAKES) });
    const b = recipe({ id: "b", name: "B", structuredIngredients: seedRows(PANCAKES) });
    expect(findPossibleRecipeDuplicates([a, b], catalog)).toEqual([]);
    expect(findExactRecipeDuplicates([a, b], catalog)).toHaveLength(1);
  });

  it("Alt-/unvollständige Rezepte nehmen nie an der Near-Duplicate-Suche teil", () => {
    const structured = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: seedRows(PANCAKES) });
    const legacy = recipe({ id: "b", name: "Protein Pancakes Legacy", freeTextIngredients: seedRows(PANCAKES).map((r) => `${r.amount} ${r.unit} ${r.displayName}`) });
    expect(findPossibleRecipeDuplicates([structured, legacy], catalog)).toEqual([]);
  });

  it("die 60 echten Katalog-Rezepte liefern nur nachvollziehbare Paare (nie 100% ohne echten Ingredient-Overlap)", () => {
    const inputs = built.map((r) => seedRecipe(r.slug));
    const pairs = findPossibleRecipeDuplicates(inputs, catalog);
    for (const pair of pairs) {
      expect(pair.ingredientOverlap).toBeGreaterThanOrEqual(0.34);
      expect(pair.score).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe("findInsufficientDataRecipes (Legacy)", () => {
  it("ein Rezept ohne jede strukturierte Zutat gilt als insufficient_data", () => {
    const legacy = recipe({ id: "a", name: "Altrezept", freeTextIngredients: ["200 g Linsen"] });
    const [entry] = findInsufficientDataRecipes([legacy], catalog);
    expect(entry).toMatchObject({ status: "insufficient_data", recipeId: "a" });
    expect(entry.reason).toMatch(/Altrezept/);
  });

  it("unvollständige strukturierte Daten (fehlende Food-Referenz) gelten ebenfalls als insufficient_data, mit anderem Grund", () => {
    const partial = recipe({ id: "a", name: "Halb erfasst", structuredIngredients: [row("skyr", 100, "g"), row(null, 40, "g")] });
    const [entry] = findInsufficientDataRecipes([partial], catalog);
    expect(entry.reason).toMatch(/unvollständig/);
  });

  it("fehlende Food-Referenz (unbekannte Food-ID) zählt ebenso als unzureichend", () => {
    const unknown = recipe({ id: "a", name: "X", structuredIngredients: [row("does-not-exist", 40, "g")] });
    expect(findInsufficientDataRecipes([unknown], catalog)).toHaveLength(1);
  });

  it("ein vollständig strukturiertes Rezept erscheint nicht in der Liste", () => {
    expect(findInsufficientDataRecipes([seedRecipe(PANCAKES)], catalog)).toEqual([]);
  });

  it("die 30 Altrezepte des echten Katalogs (ohne RecipeIngredient-Zeilen) sind vollständig als insufficient_data erfasst", () => {
    const legacyLike = Array.from({ length: 30 }, (_, i) =>
      recipe({ id: `legacy-${i}`, name: `Altrezept ${i}`, freeTextIngredients: ["1 Stück Irgendwas"] }),
    );
    const entries = findInsufficientDataRecipes(legacyLike, catalog);
    expect(entries).toHaveLength(30);
    expect(entries.every((e) => e.reason.includes("Altrezept"))).toBe(true);
  });
});

describe("auditRecipeCatalogQuality: Quality Issues", () => {
  it("fehlender Slug wird gemeldet (info bei Altrezept, warning bei strukturiertem Rezept)", () => {
    const legacy = recipe({ id: "a", name: "Altrezept", freeTextIngredients: ["1 Ei"] });
    const structuredNoSlug = recipe({ id: "b", name: "B", structuredIngredients: [row("skyr", 100, "g")] });
    expect(auditRecipeCatalogQuality([legacy], catalog)).toContainEqual(expect.objectContaining({ code: "missing-slug", severity: "info" }));
    expect(auditRecipeCatalogQuality([structuredNoSlug], catalog)).toContainEqual(expect.objectContaining({ code: "missing-slug", severity: "warning" }));
  });

  it("fehlende Ingredients (weder strukturiert noch Freitext) ist ein Fehler", () => {
    const empty = recipe({ id: "a", name: "Leer" });
    expect(auditRecipeCatalogQuality([empty], catalog)).toContainEqual(expect.objectContaining({ code: "no-ingredient-data", severity: "error" }));
  });

  it("nur Freitext ohne Struktur ist ein reiner Hinweis (info), kein Fehler", () => {
    const legacy = recipe({ id: "a", name: "Altrezept", freeTextIngredients: ["1 Ei", "200 g Mehl"] });
    const issues = auditRecipeCatalogQuality([legacy], catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "no-structured-ingredients", severity: "info" }));
    expect(issues.some((i) => i.severity === "error")).toBe(false);
  });

  it("ungültige Food-Referenz (fehlend UND unbekannt) wird je Fall unterschieden", () => {
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row(null, 40, "g", { displayName: "Mysteriöses Pulver" }), row("does-not-exist", 40, "g")] });
    const issues = auditRecipeCatalogQuality([r], catalog);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing-food-reference", severity: "error" }));
    expect(issues).toContainEqual(expect.objectContaining({ code: "invalid-food-reference", severity: "error", detail: { foodId: "does-not-exist" } }));
  });

  it("fehlende Nutrition-Daten bei einem verwendeten (nicht-negligible) Food werden erkannt", () => {
    const foods = [...catalog.all().filter((f) => f.id !== "kein-nutrition-food"), { ...catalog.get("skyr")!, id: "kein-nutrition-food", name: "Food ohne Nährwerte", nutrition: null, negligible: false }];
    const noNutritionCatalog = new FoodCatalog(foods, []);
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row("kein-nutrition-food", 100, "g")] });
    expect(auditRecipeCatalogQuality([r], noNutritionCatalog)).toContainEqual(expect.objectContaining({ code: "missing-nutrition-data", severity: "warning" }));
  });

  it("ein Gewürz (negligible) ohne Nährwerte löst KEINEN Hinweis aus - das ist das erwartete Muster", () => {
    const salt = catalog.all().find((f) => f.negligible);
    expect(salt).toBeDefined();
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row(salt!.id, 1, "pinch")] });
    expect(auditRecipeCatalogQuality([r], catalog).some((i) => i.code === "missing-nutrition-data")).toBe(false);
  });

  it("eine nicht umrechenbare Menge/Einheit (Prise ohne Grammangabe) wird gemeldet, außer bei negligible Foods", () => {
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row("skyr", 1, "pinch")] });
    expect(auditRecipeCatalogQuality([r], catalog)).toContainEqual(expect.objectContaining({ code: "invalid-quantity-unit", severity: "warning" }));
  });

  it("ein Ei ohne Mengenangabe ('nach Geschmack') ist legitim und löst keinen Mengen-Fehler aus", () => {
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row("skyr", null, null)] });
    expect(auditRecipeCatalogQuality([r], catalog).some((i) => i.code === "invalid-quantity-unit")).toBe(false);
  });

  it("optionale Zutaten werden für Menge/Nährwert nicht geprüft, aber eine ungültige Food-Referenz bleibt sichtbar", () => {
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row("skyr", 1, "pinch", { optional: true }), row("does-not-exist", 10, "g", { optional: true })] });
    const issues = auditRecipeCatalogQuality([r], catalog);
    expect(issues.some((i) => i.code === "invalid-quantity-unit")).toBe(false);
    expect(issues).toContainEqual(expect.objectContaining({ code: "invalid-food-reference" }));
  });

  it("doppelte Ingredients innerhalb eines Rezepts werden erkannt", () => {
    const r = recipe({ id: "a", name: "R", structuredIngredients: [row("oel", 5, "el"), row("oel", 10, "g")] });
    expect(auditRecipeCatalogQuality([r], catalog)).toContainEqual(expect.objectContaining({ code: "duplicate-ingredient", severity: "warning", detail: { foodId: "oel", count: 2 } }));
  });

  it("fehlender Name ist ein Fehler", () => {
    const r = recipe({ id: "a", name: "  ", structuredIngredients: [row("skyr", 100, "g")] });
    expect(auditRecipeCatalogQuality([r], catalog)).toContainEqual(expect.objectContaining({ code: "missing-name", severity: "error" }));
  });

  it("ein vollständiges, gültiges strukturiertes Rezept erzeugt keine Quality Issues", () => {
    expect(auditRecipeCatalogQuality([seedRecipe(PANCAKES)], catalog)).toEqual([]);
  });

  it("keine automatische Reparatur: der Audit ist rein lesend und verändert die Eingabe nicht", () => {
    const rows = [row("skyr", 100, "g"), row(null, 40, "g")];
    const frozenRows = rows.map((r) => Object.freeze({ ...r }));
    const r = recipe({ id: "a", name: "R", structuredIngredients: frozenRows as QualityIngredientRow[] });
    expect(() => auditRecipeCatalogQuality([r], catalog)).not.toThrow();
  });
});

describe("buildRecipeCatalogQualityReport: zentraler Report", () => {
  it("fasst alle Bereiche zusammen und zählt konsistent", () => {
    const dup = seedRows(PANCAKES);
    const a = recipe({ id: "a", name: "A", structuredIngredients: dup });
    const b = recipe({ id: "b", name: "B", structuredIngredients: dup });
    const legacy = recipe({ id: "c", name: "Altrezept", freeTextIngredients: ["1 Ei"] });
    const badRef = recipe({ id: "d", name: "D", structuredIngredients: [row("does-not-exist", 10, "g")] });

    const report = buildRecipeCatalogQualityReport([a, b, legacy, badRef], catalog);

    expect(report.summary.totalRecipes).toBe(4);
    expect(report.summary.exactDuplicateGroups).toBe(1);
    expect(report.summary.recipesInExactDuplicates).toBe(2);
    expect(report.summary.insufficientDataRecipes).toBe(2); // legacy + badRef
    expect(report.summary.structuredRecipes).toBe(2); // a + b
    expect(report.exactDuplicates).toHaveLength(1);
    expect(report.insufficientData.map((e) => e.recipeId).sort()).toEqual(["c", "d"]);
    expect(report.qualityIssues.length).toBeGreaterThan(0);
    expect(report.summary.qualityIssues).toBe(report.qualityIssues.length);
    const bySeverity = report.summary.qualityIssuesBySeverity;
    expect(bySeverity.error + bySeverity.warning + bySeverity.info).toBe(report.qualityIssues.length);
  });

  it("Regression/Smoke-Test: die 60 echten Katalog-Rezepte laufen fehlerfrei durch den Report", () => {
    const inputs = built.map((r) => seedRecipe(r.slug));
    expect(() => buildRecipeCatalogQualityReport(inputs, catalog)).not.toThrow();
    const report = buildRecipeCatalogQualityReport(inputs, catalog);
    expect(report.summary.totalRecipes).toBe(60);
    expect(report.summary.structuredRecipes).toBe(60);
    expect(report.summary.insufficientDataRecipes).toBe(0);
    expect(report.exactDuplicates).toEqual([]);
  });

  it("Altrezepte werden nicht fälschlich als vollständig strukturiert behandelt, auch inmitten des echten Katalogs", () => {
    const inputs = [...built.map((r) => seedRecipe(r.slug)), recipe({ id: "legacy-1", name: "Omas Eintopf", freeTextIngredients: ["200 g Linsen", "1 Zwiebel"] })];
    const report = buildRecipeCatalogQualityReport(inputs, catalog);
    expect(report.summary.totalRecipes).toBe(61);
    expect(report.summary.insufficientDataRecipes).toBe(1);
    expect(report.insufficientData[0].recipeId).toBe("legacy-1");
    expect(report.exactDuplicates.every((g) => !g.recipes.some((r) => r.id === "legacy-1"))).toBe(true);
  });
});
