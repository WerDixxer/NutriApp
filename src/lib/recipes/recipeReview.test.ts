import { describe, expect, it } from "vitest";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import {
  auditRecipeCatalogQuality,
  buildRecipeCatalogQualityReport,
  findExactRecipeDuplicates,
  findInsufficientDataRecipes,
  findPossibleRecipeDuplicates,
  type QualityIngredientRow,
  type QualityRecipeInput,
  type RecipeCatalogQualityReport,
} from "./catalogQuality";
import { buildRecipeReviewQueue, REVIEW_STATUSES, type RecipeReviewItem, type ReviewCategory } from "./recipeReview";
import type { RecipeUnit } from "./types";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

function row(foodId: string | null, amount: number | null, unit: RecipeUnit | null, opts: Partial<QualityIngredientRow> = {}): QualityIngredientRow {
  return { foodId, displayName: foodId ? (catalog.get(foodId)?.name ?? foodId) : "Unbekannt", amount, unit, optional: false, ...opts };
}
function recipe(overrides: Partial<QualityRecipeInput> & { id: string; name: string }): QualityRecipeInput {
  return { slug: null, servings: 1, structuredIngredients: [], freeTextIngredients: [], tags: [], ...overrides };
}
function seedRows(slug: string): QualityIngredientRow[] {
  const r = built.find((x) => x.slug === slug)!;
  return r.ingredients.map((i) => row(i.foodId, i.amount, i.unit, { optional: i.optional, ...(i.gramsOverride !== undefined ? { gramsOverride: i.gramsOverride } : {}) }));
}
function seedRecipe(slug: string, overrides: Partial<QualityRecipeInput> = {}): QualityRecipeInput {
  const r = built.find((x) => x.slug === slug)!;
  return recipe({ id: slug, slug, name: r.name, servings: r.servings, structuredIngredients: seedRows(slug), tags: r.tags, ...overrides });
}

function report(recipes: QualityRecipeInput[]): RecipeCatalogQualityReport {
  return buildRecipeCatalogQualityReport(recipes, catalog);
}

function itemFor(items: RecipeReviewItem[], id: string): RecipeReviewItem {
  const item = items.find((i) => i.recipeId === id);
  if (!item) throw new Error(`kein Review-Item für ${id}`);
  return item;
}

const PANCAKES = "protein-pancakes-with-berries";

describe("buildRecipeReviewQueue: Kategorien (Queue)", () => {
  it("ein Quality Issue erscheint als eigene Kategorie", () => {
    // slug gesetzt, damit ausschließlich die doppelte Zutat als Issue auftritt (isoliert testbar).
    const withDupe = recipe({ id: "a", slug: "a", name: "A", structuredIngredients: [row("skyr", 100, "g"), row("skyr", 50, "g")] });
    const queue = buildRecipeReviewQueue([withDupe], report([withDupe]));
    const item = itemFor(queue.items, "a");
    expect(item.category).toBe("quality_issue");
    expect(item.qualityIssues).toEqual([expect.objectContaining({ code: "duplicate-ingredient" })]);
    expect(item.reviewReason).toContain("kommt 2×");
  });

  it("ein Possible Duplicate erscheint mit Kandidat und Similarity im Grund", () => {
    const base = seedRows(PANCAKES).filter((r) => r.foodId !== "beeren");
    const a = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: base, tags: ["breakfast"] });
    const b = recipe({ id: "b", name: "Protein Pancakes with Berries", structuredIngredients: seedRows(PANCAKES), tags: ["breakfast"] });
    const queue = buildRecipeReviewQueue([a, b], report([a, b]));
    const item = itemFor(queue.items, "a");
    expect(item.category).toBe("duplicate_possible");
    expect(item.duplicateCandidates).toHaveLength(1);
    expect(item.duplicateCandidates[0]).toMatchObject({ kind: "possible", recipe: { id: "b", name: "Protein Pancakes with Berries" } });
    expect(item.duplicateCandidates[0].score).toBeGreaterThan(0.6);
    expect(item.reviewReason).toMatch(/Similarity \d\.\d\d/);
  });

  it("ein Clean Recipe ohne Issues und ohne Duplicate-Kandidaten erscheint als 'clean'", () => {
    const clean = seedRecipe("chicken-fajitas");
    const queue = buildRecipeReviewQueue([clean], report([clean]));
    const item = itemFor(queue.items, "chicken-fajitas");
    expect(item.category).toBe("clean");
    expect(item.qualityIssues).toEqual([]);
    expect(item.duplicateCandidates).toEqual([]);
  });

  it("ein Legacy-Rezept ohne strukturierte Zutaten wird korrekt als insufficient_data geführt", () => {
    const legacy = recipe({ id: "legacy-1", name: "Omas Eintopf", freeTextIngredients: ["200 g Linsen", "1 Zwiebel"] });
    const queue = buildRecipeReviewQueue([legacy], report([legacy]));
    const item = itemFor(queue.items, "legacy-1");
    expect(item.category).toBe("insufficient_data");
    expect(item.insufficientDataReason).toMatch(/Altrezept/);
    expect(item.duplicateCandidates).toEqual([]);
  });

  it("Priorität: exaktes Duplikat schlägt ein zusätzliches Quality Issue auf demselben Rezept", () => {
    const dupeRows = [row("skyr", 100, "g"), row("skyr", 100, "g")]; // gleichzeitig exakt UND doppelte Zutat
    const a = recipe({ id: "a", name: "A", structuredIngredients: dupeRows });
    const b = recipe({ id: "b", name: "B", structuredIngredients: dupeRows });
    const queue = buildRecipeReviewQueue([a, b], report([a, b]));
    expect(itemFor(queue.items, "a").category).toBe("duplicate_exact");
    expect(itemFor(queue.items, "a").qualityIssues.some((i) => i.code === "duplicate-ingredient")).toBe(true);
  });

  it("die Reihenfolge ist rein technisch: exact vor possible vor insufficient_data vor quality_issue vor clean", () => {
    // Exaktes Duplikat-Paar strukturell unabhängig von der Possible-Duplicate-Fixture unten
    // (sonst würde die Namens-/Tag-Ähnlichkeit der einen Fixture die Similarity der anderen verfälschen).
    const dupA = recipe({ id: "dupA", name: "Dup A", structuredIngredients: seedRows("chicken-teriyaki-rice-bowl") });
    const dupB = recipe({ id: "dupB", name: "Dup B", structuredIngredients: seedRows("chicken-teriyaki-rice-bowl") });
    const possibleBase = seedRows(PANCAKES).filter((r) => r.foodId !== "beeren");
    const possibleA = recipe({ id: "posA", name: "Protein Pancakes", structuredIngredients: possibleBase, tags: ["breakfast"] });
    const possibleB = seedRecipe(PANCAKES, { id: "posB" });
    const legacy = recipe({ id: "legacy", name: "Altrezept", freeTextIngredients: ["1 Ei"] });
    const issue = recipe({ id: "issue", name: "Mit Issue", structuredIngredients: [row("skyr", 1, "pinch")] });
    const clean = seedRecipe("chicken-fajitas");

    const recipes = [clean, issue, legacy, possibleA, possibleB, dupB, dupA];
    const queue = buildRecipeReviewQueue(recipes, report(recipes));
    const categories = queue.items.map((i) => i.category);
    const firstIndex = (c: ReviewCategory) => categories.indexOf(c);
    const lastIndex = (c: ReviewCategory) => categories.lastIndexOf(c);
    expect(lastIndex("duplicate_exact")).toBeLessThan(firstIndex("duplicate_possible"));
    expect(lastIndex("duplicate_possible")).toBeLessThan(firstIndex("insufficient_data"));
    expect(lastIndex("insufficient_data")).toBeLessThan(firstIndex("quality_issue"));
    expect(lastIndex("quality_issue")).toBeLessThan(firstIndex("clean"));
  });

  it("jedes Item startet mit Status 'pending', unabhängig von der Kategorie", () => {
    const recipes = [seedRecipe("chicken-fajitas"), recipe({ id: "legacy", name: "Altrezept", freeTextIngredients: ["1 Ei"] })];
    const queue = buildRecipeReviewQueue(recipes, report(recipes));
    expect(queue.items.every((i) => i.status === "pending")).toBe(true);
  });

  it("summary.byCategory zählt konsistent mit den Items", () => {
    const recipes = [seedRecipe("chicken-fajitas"), recipe({ id: "legacy", name: "Altrezept", freeTextIngredients: ["1 Ei"] })];
    const queue = buildRecipeReviewQueue(recipes, report(recipes));
    const counted = Object.values(queue.summary.byCategory).reduce((a, b) => a + b, 0);
    expect(counted).toBe(queue.items.length);
    expect(queue.summary.total).toBe(queue.items.length);
  });

  it("reine Performance-Erwartung: baut ausschließlich aus dem übergebenen Report, ruft keine der Kapitel-18-Detektoren selbst erneut auf", () => {
    // Ein Report mit einem KÜNSTLICH manipulierten (falschen) exactDuplicates-Feld muss sich
    // unverändert in der Queue widerspiegeln - das beweist, dass buildRecipeReviewQueue selbst
    // keinen zweiten Duplicate-Scan durchführt, sondern dem Report vertraut.
    const a = seedRecipe("chicken-fajitas", { id: "a" });
    const b = seedRecipe("protein-pancakes-with-berries", { id: "b" });
    const realReport = report([a, b]);
    expect(realReport.exactDuplicates).toEqual([]); // die echten Rezepte sind kein Duplikat
    const fakedReport: RecipeCatalogQualityReport = {
      ...realReport,
      exactDuplicates: [{ status: "exact", signature: "fake", recipes: [{ id: "a", slug: "chicken-fajitas", name: "A" }, { id: "b", slug: "protein-pancakes-with-berries", name: "B" }], sharedFeatures: ["Fake"] }],
    };
    const queue = buildRecipeReviewQueue([a, b], fakedReport);
    expect(itemFor(queue.items, "a").category).toBe("duplicate_exact");
    expect(itemFor(queue.items, "a").duplicateCandidates[0].sharedFeatures).toEqual(["Fake"]);
  });
});

describe("Review Detail: Duplicate-Vergleich nachvollziehbar", () => {
  it("Duplicate Candidate, Similarity Score und gemeinsame Ingredients werden korrekt angezeigt (Kapitel-Beispiel)", () => {
    // Nachgebautes Beispiel aus dem Auftrag: "Protein Banana Shake" vs. "Protein Chocolate Milk + Banana".
    const shake = recipe({
      id: "shake",
      name: "Protein Banana Shake",
      structuredIngredients: [row("milch", 250, "ml"), row("proteinpulver", 30, "g", { unit: "g" }), row("banane", 1, "piece")],
      tags: ["post-strength"],
    });
    const chocolateMilk = recipe({
      id: "choc",
      name: "Protein Chocolate Milk + Banana",
      structuredIngredients: [row("milch", 250, "ml"), row("proteinpulver", 30, "g"), row("banane", 1, "piece"), row("kakaopulver", 10, "g")],
      tags: ["post-strength"],
    });
    const queue = buildRecipeReviewQueue([shake, chocolateMilk], report([shake, chocolateMilk]));
    const item = itemFor(queue.items, "shake");
    expect(item.category).toBe("duplicate_possible");
    const [candidate] = item.duplicateCandidates;
    expect(candidate.recipe.name).toBe("Protein Chocolate Milk + Banana");
    expect(candidate.score).toBeGreaterThan(0.6);
    expect(candidate.sharedFeatures.sort()).toEqual(["Banane", "Milch", "Proteinpulver"].sort());
  });

  it("bei einem exakten Duplikat sind die Merkmale die vollständige, lesbare Zutatenliste", () => {
    const a = recipe({ id: "a", name: "A", structuredIngredients: [row("skyr", 100, "g"), row("haferflocken", 40, "g")] });
    const b = recipe({ id: "b", name: "B", structuredIngredients: [row("skyr", 100, "g"), row("haferflocken", 40, "g")] });
    const queue = buildRecipeReviewQueue([a, b], report([a, b]));
    const [candidate] = itemFor(queue.items, "a").duplicateCandidates;
    expect(candidate.kind).toBe("exact");
    expect(candidate.score).toBe(1);
    expect(candidate.sharedFeatures.sort()).toEqual(["100 g Skyr", "40 g Haferflocken"].sort());
  });

  it("Quality Issues eines Rezepts sind vollständig im Review-Item enthalten", () => {
    const r = recipe({ id: "a", slug: "a", name: "A", structuredIngredients: [row(null, 40, "g"), row("skyr", 1, "pinch")] });
    const queue = buildRecipeReviewQueue([r], report([r]));
    const item = itemFor(queue.items, "a");
    expect(item.qualityIssues.map((i) => i.code).sort()).toEqual(["invalid-quantity-unit", "missing-food-reference"].sort());
  });

  it("Chicken vs. Tofu bleibt über dietClassDiffers nachvollziehbar, falls es als Kandidat erscheint, aber ist nie exact", () => {
    const chicken = recipe({ id: "chicken", name: "Chicken Rice Bowl", structuredIngredients: [row("haehnchenbrust", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g"), row("teriyaki-sauce", 20, "g")], tags: ["omnivore"] });
    const tofu = recipe({ id: "tofu", name: "Tofu Rice Bowl", structuredIngredients: [row("tofu", 150, "g"), row("reis", 100, "g"), row("brokkoli", 80, "g"), row("teriyaki-sauce", 20, "g")], tags: ["vegan"] });
    const queue = buildRecipeReviewQueue([chicken, tofu], report([chicken, tofu]));
    expect(itemFor(queue.items, "chicken").category).not.toBe("duplicate_exact");
    for (const item of queue.items) for (const c of item.duplicateCandidates) expect(c.dietClassDiffers).toBe(true);
  });
});

describe("ReviewStatus (UI-State, keine Persistenz)", () => {
  it("alle vier geforderten Statuswerte sind definiert, in dieser Reihenfolge", () => {
    expect(REVIEW_STATUSES).toEqual(["pending", "needs_changes", "approved", "rejected"]);
  });

  it("die Queue selbst kennt keinen anderen Status als 'pending' - Persistenz ist bewusst nicht Teil dieses Moduls", () => {
    const recipes = [seedRecipe("chicken-fajitas")];
    const queue = buildRecipeReviewQueue(recipes, report(recipes));
    // Zweimaliger Aufbau (entspricht zwei Seitenaufrufen/einem Reload) liefert wieder "pending".
    const again = buildRecipeReviewQueue(recipes, report(recipes));
    expect(queue.items[0].status).toBe("pending");
    expect(again.items[0].status).toBe("pending");
  });
});

describe("Regression: die Kapitel-18-Funktionen bleiben unverändert nutzbar", () => {
  it("findExactRecipeDuplicates, findPossibleRecipeDuplicates, findInsufficientDataRecipes und auditRecipeCatalogQuality funktionieren weiterhin direkt", () => {
    const a = recipe({ id: "a", slug: "a", name: "A", structuredIngredients: [row("skyr", 100, "g")] });
    const b = recipe({ id: "b", slug: "b", name: "B", structuredIngredients: [row("skyr", 100, "g")] });
    expect(findExactRecipeDuplicates([a, b], catalog)).toHaveLength(1);
    expect(findPossibleRecipeDuplicates([a, b], catalog)).toEqual([]);
    expect(findInsufficientDataRecipes([recipe({ id: "c", name: "C" })], catalog)).toHaveLength(1);
    expect(auditRecipeCatalogQuality([a], catalog)).toEqual([]);
  });

  it("possibleDuplicates tragen jetzt zusätzlich sharedFoodNames, ohne bestehende Felder zu verändern", () => {
    const base = seedRows(PANCAKES).filter((r) => r.foodId !== "beeren");
    const a = recipe({ id: "a", name: "Protein Pancakes", structuredIngredients: base });
    const b = recipe({ id: "b", name: "Protein Pancakes with Berries", structuredIngredients: seedRows(PANCAKES) });
    const [pair] = findPossibleRecipeDuplicates([a, b], catalog);
    expect(pair.sharedFoodNames).toEqual(expect.arrayContaining(["Skyr", "Haferflocken"]));
    expect(pair.sharedFoodIds).toEqual(expect.arrayContaining(["skyr", "haferflocken"]));
  });

  it("die 60 echten Katalog-Rezepte laufen fehlerfrei durch Report und Review-Queue (Smoke-Test)", () => {
    const inputs = built.map((r) => seedRecipe(r.slug));
    const realReport = report(inputs);
    const queue = buildRecipeReviewQueue(inputs, realReport);
    expect(queue.items).toHaveLength(60);
    expect(queue.items.every((i) => i.status === "pending")).toBe(true);
  });
});
