import type { RawImportedIngredient, RawImportedRecipe } from "../recipeImport";

/**
 * Feste, deterministische Import-Fixtures für Kapitel 20 (kein Netzwerk, kein Scraping,
 * keine echte externe Quelle). Jede Fixture ist bewusst so gewählt, dass sie GENAU EINEN
 * Pipeline-Aspekt isoliert zeigt, statt mehrere Befunde zu vermischen - siehe die einzelnen
 * Kommentare. Alle Mengen-/Food-/Alias-Angaben sind gegen `data/foods.ts` verifiziert, nichts
 * hier ist geraten.
 */

const IMPORTED_AT = new Date("2026-01-15T09:00:00.000Z");

function line(originalText: string, hints: Partial<Omit<RawImportedIngredient, "originalText">> = {}): RawImportedIngredient {
  return { originalText, ...hints };
}

/**
 * A - vollständig auflösbar: jede Zutat hat eine bekannte Alias-/Namensauflösung
 * ("oats" -> haferflocken via Alias, "Skyr"/"Banane" via exakten Namen), jede Menge/Einheit
 * ist eindeutig erkennbar, jedes Food hat Nährwerte. Erwartetes Ergebnis: normalisiert, keine
 * Validation-Issues, "ready_for_review" (sofern kein Duplikat).
 */
export const IMPORT_FIXTURE_RESOLVABLE: RawImportedRecipe = {
  source: { type: "mock", label: "Mock Recipe Feed", externalId: "mock-a-resolvable", url: "https://example.invalid/recipes/a" },
  name: "Protein Pancakes",
  description: "Einfache Protein-Pancakes aus Skyr, Haferflocken und Banane.",
  ingredients: [line("100 g Skyr"), line("50 g oats"), line("1 Banane")],
  instructions: ["Alle Zutaten verrühren.", "In einer Pfanne goldbraun ausbacken."],
  prepTimeMin: 10,
  servings: 1,
  tags: ["breakfast", "high-protein"],
  imageRef: null,
  importedAt: IMPORTED_AT,
  rawSourceMetadata: { feedEntryId: "a-resolvable" },
};

/**
 * B - Unknown Food: "Dragon Fruit Powder" existiert in keinem Food/Alias des Katalogs
 * (bewusst kein Substring-/Fuzzy-Treffer möglich, siehe `FoodCatalog.resolveLabel`).
 * Erwartetes Ergebnis: `resolutionStatus: "unresolved"` für diese Zutat, ein
 * "unresolved-food"-Validation-Issue, Pipeline erreicht trotzdem "ready_for_review" (Warning,
 * kein Error) - Skyr bleibt separat auflösbar, damit klar ist, dass NUR die unbekannte Zutat
 * betroffen ist.
 */
export const IMPORT_FIXTURE_UNKNOWN_FOOD: RawImportedRecipe = {
  source: { type: "mock", label: "Mock Recipe Feed", externalId: "mock-b-unknown-food", url: "https://example.invalid/recipes/b" },
  name: "Dragon Fruit Skyr Bowl",
  description: "Skyr-Bowl mit einer exotischen Zutat, die der Katalog nicht kennt.",
  ingredients: [line("100 g Skyr"), line("20 g Dragon Fruit Powder")],
  instructions: ["Skyr in eine Schüssel geben.", "Dragon Fruit Powder unterrühren."],
  prepTimeMin: 5,
  servings: 1,
  tags: ["breakfast"],
  imageRef: null,
  importedAt: IMPORTED_AT,
  rawSourceMetadata: { feedEntryId: "b-unknown-food" },
};

/**
 * C - Possible Duplicate: spiegelt das echte Katalog-Rezept `protein-pancakes-with-berries`
 * (data/recipes.ts) bis auf die Beeren - gleiche Kernzutaten (Haferflocken/Ei/Skyr/Milch/
 * Backpulver), anderer Name. Soll von `findPossibleRecipeDuplicates` (catalogQuality.ts,
 * Kapitel 18, unverändert wiederverwendet) als möglicher Duplicate-Kandidat erkannt werden.
 */
export const IMPORT_FIXTURE_POSSIBLE_DUPLICATE: RawImportedRecipe = {
  source: { type: "mock", label: "Mock Recipe Feed", externalId: "mock-c-possible-duplicate", url: "https://example.invalid/recipes/c" },
  name: "Protein Pancakes with Blueberries",
  description: "Fluffige Haferflocken-Pancakes mit Skyr, ganz ähnlich einem Katalog-Klassiker.",
  ingredients: [line("40 g Haferflocken"), line("1 Ei"), line("100 g Skyr"), line("50 ml Milch"), line("0.5 TL Backpulver")],
  instructions: ["Haferflocken zu Mehl mixen.", "Ei, Skyr, Milch und Backpulver vermischen.", "Teig in einer Pfanne ausbacken."],
  prepTimeMin: 5,
  servings: 1,
  tags: ["vegetarian", "high-protein", "breakfast"],
  imageRef: null,
  importedAt: IMPORTED_AT,
  rawSourceMetadata: { feedEntryId: "c-possible-duplicate" },
};

/**
 * D - Missing Nutrition: "Eiersatz" ist ein echtes, auflösbares Food im Katalog
 * (`data/foods.ts`), hat dort aber bewusst `nutrition: null` ("produktabhängig") und ist NICHT
 * `negligible` - anders als z.B. Gewürze, deren fehlende Nährwerte ignoriert werden dürfen.
 * Erwartetes Ergebnis: Food löst auf, aber `computeRecipeNutrition` markiert die Zeile als
 * unresolved-für-Nährwerte und `validateImportCandidate` meldet "missing-nutrition".
 */
export const IMPORT_FIXTURE_MISSING_NUTRITION: RawImportedRecipe = {
  source: { type: "mock", label: "Mock Recipe Feed", externalId: "mock-d-missing-nutrition", url: "https://example.invalid/recipes/d" },
  name: "Skyr-Omelett mit Eiersatz",
  description: "Herzhaftes Omelett auf Basis von Eiersatz, dessen Nährwerte produktabhängig sind.",
  ingredients: [line("100 g Skyr"), line("20 g Eiersatz")],
  instructions: ["Eiersatz anrühren.", "Mit Skyr verfeinern."],
  prepTimeMin: 8,
  servings: 1,
  tags: ["vegan"],
  imageRef: null,
  importedAt: IMPORTED_AT,
  rawSourceMetadata: { feedEntryId: "d-missing-nutrition" },
};

/**
 * E - Invalid Ingredient: die zweite Zutat kommt über einen strukturierten Hint der Quelle
 * (`labelHint`, kein `amountHint`) - ein realistischer Fall, in dem eine externe Quelle zwar
 * das Food benennt, aber keine Menge liefert ("Haferflocken, Menge unbekannt"). Das Food LÖST
 * AUF (bewusst kein Alias-/Food-Problem), nur Menge/Einheit bleiben unbekannt - isoliert damit
 * "invalid-amount-or-unit" von "unresolved-food" (Fixture B), statt beide Fehlerarten zu
 * vermischen.
 */
export const IMPORT_FIXTURE_INVALID_INGREDIENT: RawImportedRecipe = {
  source: { type: "mock", label: "Mock Recipe Feed", externalId: "mock-e-invalid-ingredient", url: "https://example.invalid/recipes/e" },
  name: "Skyr-Hafer-Mix ohne Mengenangabe",
  description: "Ein Rezept, dessen Quelle bei einer Zutat keine Menge geliefert hat.",
  ingredients: [line("100 g Skyr"), line("Haferflocken (Menge unklar)", { labelHint: "Haferflocken" })],
  instructions: ["Skyr und Haferflocken vermischen."],
  prepTimeMin: 5,
  servings: 1,
  tags: ["breakfast"],
  imageRef: null,
  importedAt: IMPORTED_AT,
  rawSourceMetadata: { feedEntryId: "e-invalid-ingredient" },
};

/** Alle fünf Fixtures gebündelt, in der Reihenfolge A-E - praktisch für `createMockExternalRecipeSource`. */
export const IMPORT_FIXTURES: RawImportedRecipe[] = [
  IMPORT_FIXTURE_RESOLVABLE,
  IMPORT_FIXTURE_UNKNOWN_FOOD,
  IMPORT_FIXTURE_POSSIBLE_DUPLICATE,
  IMPORT_FIXTURE_MISSING_NUTRITION,
  IMPORT_FIXTURE_INVALID_INGREDIENT,
];
