import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchesAllergen } from "../foodMatching";
import {
  activeFilterCount,
  browseCatalog,
  buildCatalogCard,
  buildDiscoverSections,
  cardHint,
  catalogQueryToSearchParams,
  isFilterActive,
  parseCatalogQuery,
  searchBrowseRecipes,
  toggleFilter,
  type BrowsePreferences,
  type BrowseRecipe,
  type CatalogQuery,
} from "./catalogBrowser";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { dbRecipeToDetail } from "../recipeDetail";
import { RECIPES } from "./data/recipes";
import { filterRecipes } from "./filters";
import { createFoodPreferenceContext, isDislikedHit, isLikedHit } from "./foodPreferences";
import { formatIngredientLine } from "./units";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

/** Die 60 Seed-Rezepte in der Form, die der Katalog-Browser aus der Datenbank bekommt. */
const recipes: BrowseRecipe[] = built.map((r) => ({
  id: r.slug,
  slug: r.slug,
  name: r.name,
  description: r.description,
  kcal: r.nutrition.kcal,
  proteinG: r.nutrition.proteinG,
  carbsG: r.nutrition.carbsG,
  fatG: r.nutrition.fatG,
  timeMin: r.totalTimeMin,
  servings: r.servings,
  mealSlots: r.mealSlots,
  dietTypes: r.dietTypes,
  tags: r.tags,
  mealPrepSuitable: r.mealPrepSuitable,
  cuisine: r.cuisine,
  allergens: r.allergens,
  ingredients: r.ingredients,
  ingredientLines: r.ingredients.map(formatIngredientLine),
}));

const noPreferences: BrowsePreferences = { allergyLabels: [], favoriteFoods: [], dislikedFoods: [] };
const emptyQuery: CatalogQuery = { q: "", filter: {}, showBlocked: false };

const search = (q: string) => searchBrowseRecipes(recipes, q, catalog).map((r) => r.slug);
const browse = (query: Partial<CatalogQuery>, preferences: Partial<BrowsePreferences> = {}) =>
  browseCatalog(recipes, { ...emptyQuery, ...query }, { ...noPreferences, ...preferences }, catalog);

const toRow = (r: BrowseRecipe) => ({
  id: r.id, name: r.name, description: r.description, imageQuery: null, kcal: r.kcal, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG,
  prepTimeMin: r.timeMin, totalTimeMin: r.timeMin, servings: r.servings, ingredients: "[]", instructions: "[]", isTrending: false,
  trendSource: null, tags: JSON.stringify(r.tags),
});
describe("Katalog", () => {
  it("enthält die 60 strukturierten Katalog-Rezepte, jedes mit Zutaten aus dem zentralen Food-Katalog", () => {
    expect(RECIPES).toHaveLength(60);
    expect(recipes).toHaveLength(60);
    for (const recipe of recipes) {
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      for (const ingredient of recipe.ingredients) expect(catalog.get(ingredient.foodId)).toBeDefined();
    }
  });

  it("leere Suche und leere Filter liefern den vollständigen Katalog in unveränderter Reihenfolge", () => {
    const result = browse({});
    expect(result.items.map((i) => i.recipe.slug)).toEqual(recipes.map((r) => r.slug));
    expect(result.catalogSize).toBe(60);
    expect(search("")).toHaveLength(60);
    expect(search("   ")).toHaveLength(60);
  });
});

describe("Suche: Name, Zutat, Alias", () => {
  it("'Pasta' findet Pasta-Rezepte (Name und Food-ID)", () => {
    const hits = search("Pasta");
    expect(hits).toEqual(expect.arrayContaining(["creamy-chicken-pasta", "chicken-pesto-pasta", "post-workout-protein-pasta"]));
    for (const slug of hits) {
      const r = recipes.find((x) => x.slug === slug)!;
      expect(/pasta/i.test(r.name) || r.ingredients.some((i) => i.foodId === "pasta")).toBe(true);
    }
  });

  it("'Chicken' und 'Hähnchen' finden dieselben Rezepte (Alias -> Hähnchenbrust)", () => {
    const chicken = search("Chicken");
    expect(chicken.length).toBeGreaterThan(5);
    expect(search("Hähnchen")).toEqual(chicken);
    expect(chicken).toEqual(expect.arrayContaining(["chicken-fajitas", "chicken-teriyaki-rice-bowl"]));
  });

  it("'Pancake' findet die Protein Pancakes (Namensanfang, Einzahl)", () => {
    expect(search("Pancake")).toEqual(["protein-pancakes-with-berries"]);
  });

  it("'Nudeln' (Alias von Pasta) findet die Pasta-Rezepte", () => {
    expect(search("Nudeln")).toEqual(expect.arrayContaining(["creamy-chicken-pasta", "chicken-pesto-pasta"]));
  });

  it("ein unvollständiges Wort wird über die Food-Präfixe gefunden ('Hähn')", () => {
    expect(search("Hähn")).toEqual(search("Hähnchen"));
  });

  it("mehrere Wörter müssen alle passen", () => {
    expect(search("protein pancakes")).toEqual(["protein-pancakes-with-berries"]);
    expect(search("Pancake Hähnchen")).toEqual([]);
  });

  it("ein Food aus mehreren Wörtern zählt als ein Begriff: 'Frischkäse light' trifft nur das Rezept mit dem Light-Food", () => {
    const hits = search("Frischkäse light");
    expect(hits).toContain("tuna-toast");
    for (const slug of hits) {
      expect(recipes.find((r) => r.slug === slug)!.ingredients.some((i) => i.foodId === "frischkaese-light")).toBe(true);
    }
  });

  it("Tags (auch deutsch), Küche und Beschreibung sind durchsuchbar", () => {
    expect(search("vegan")).toEqual(expect.arrayContaining(["tofu-scramble"]));
    expect(search("Frühstück")).toEqual(expect.arrayContaining(["protein-pancakes-with-berries"]));
    expect(search("italian")).toEqual(expect.arrayContaining(["creamy-chicken-pasta"]));
  });

  it.each(["Rosenkohl", "Blumenkohl", "Algen", "Trüffel"])("unbekannter Begriff '%s' liefert nichts statt Zufallstreffern", (term) => {
    expect(search(term)).toEqual([]);
  });
});

describe("Suche: keine falschen Substring-Treffer", () => {
  const withRice = (slug: string) => recipes.find((r) => r.slug === slug)!.ingredients.some((i) => i.foodId === "reis");
  const riceCakeOnly = recipes.filter((r) => r.ingredients.some((i) => i.foodId === "reiswaffeln") && !r.ingredients.some((i) => i.foodId === "reis"));

  it("'Reis' trifft Rezepte mit dem Food Reis und KEIN Rezept, das nur Reiswaffeln enthält", () => {
    expect(riceCakeOnly.length).toBeGreaterThan(0); // der Fall existiert in den Daten
    const hits = search("Reis");
    expect(hits.length).toBeGreaterThan(5);
    for (const recipe of riceCakeOnly) expect(hits).not.toContain(recipe.slug);
    expect(hits).toContain("chicken-teriyaki-rice-bowl");
    expect(withRice("chicken-teriyaki-rice-bowl")).toBe(true);
  });

  it("'Reiswaffeln' bleibt als eigenes Food auffindbar", () => {
    const hits = search("Reiswaffeln");
    for (const recipe of riceCakeOnly) expect(hits).toContain(recipe.slug);
  });

  it("'Nudeln' trifft nur Rezepte mit dem Food Pasta oder dem GANZEN Wort 'Nudeln' im Text (z. B. Zucchini-Nudeln)", () => {
    for (const slug of search("Nudeln")) {
      const r = recipes.find((x) => x.slug === slug)!;
      const isPasta = r.ingredients.some((i) => i.foodId === "pasta");
      const wholeWord = /(^|[^a-zäöüß])nudeln($|[^a-zäöüß])/i.test(`${r.name} ${r.description} ${r.ingredients.map((i) => i.displayName).join(" ")}`);
      expect(isPasta || wholeWord).toBe(true);
    }
    expect(search("Nudeln")).not.toContain("protein-pancakes-with-berries");
  });
});

describe("Filter (bestehendes filterRecipes)", () => {
  const slugs = (query: Partial<CatalogQuery>) => browse(query).items.map((i) => i.recipe.slug);

  it("Mahlzeit filtert nach mealSlots", () => {
    const hits = slugs({ filter: { mealSlots: ["BREAKFAST"] } });
    expect(hits.length).toBeGreaterThan(5);
    expect(hits).toContain("protein-pancakes-with-berries");
    for (const slug of hits) expect(recipes.find((r) => r.slug === slug)!.mealSlots).toContain("BREAKFAST");
  });

  it("Ernährungsform, Ziel, Sport, Schnell und Meal Prep filtern", () => {
    expect(slugs({ filter: { diets: ["vegan"] } })).toContain("tofu-scramble");
    expect(slugs({ filter: { highProtein: true } }).length).toBeGreaterThan(30);
    expect(slugs({ filter: { sports: ["football"] } }).length).toBeGreaterThan(0);
    for (const slug of slugs({ filter: { quick: true } })) expect(recipes.find((r) => r.slug === slug)!.timeMin).toBeLessThanOrEqual(20);
    for (const slug of slugs({ filter: { mealPrep: true } })) expect(recipes.find((r) => r.slug === slug)!.mealPrepSuitable).toBe(true);
  });

  it("Filter sind kombinierbar: Frühstück + schnell + proteinreich", () => {
    const filter = { mealSlots: ["BREAKFAST" as const], quick: true, highProtein: true };
    const combined = slugs({ filter });
    expect(combined).toEqual(filterRecipes(recipes, filter).map((r) => r.slug));
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.length).toBeLessThan(slugs({ filter: { mealSlots: ["BREAKFAST"] } }).length);
    for (const slug of combined) {
      const r = recipes.find((x) => x.slug === slug)!;
      expect(r.mealSlots).toContain("BREAKFAST");
      expect(r.timeMin).toBeLessThanOrEqual(20);
    }
  });

  it("Suche und Filter verbinden sich", () => {
    const hits = slugs({ q: "Chicken", filter: { mealSlots: ["LUNCH"] } });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(search("Chicken").length);
    for (const slug of hits) expect(search("Chicken")).toContain(slug);
  });

  it("widersprüchliche Filter liefern eine leere Liste statt eines Fehlers", () => {
    expect(slugs({ filter: { diets: ["vegan"], keto: true, protein: { min: 100 } } })).toEqual([]);
  });
});

describe("Filter-Umschalter und URL-Parameter", () => {
  it("toggleFilter schaltet Facetten ein und aus; Mahlzeiten sind mehrfach wählbar", () => {
    let q = toggleFilter(emptyQuery, { kind: "meal", value: "BREAKFAST" });
    q = toggleFilter(q, { kind: "meal", value: "LUNCH" });
    q = toggleFilter(q, { kind: "flag", value: "quick" });
    expect(q.filter).toEqual({ mealSlots: ["BREAKFAST", "LUNCH"], quick: true });
    q = toggleFilter(q, { kind: "meal", value: "BREAKFAST" });
    expect(q.filter.mealSlots).toEqual(["LUNCH"]);
    q = toggleFilter(toggleFilter(q, { kind: "meal", value: "LUNCH" }), { kind: "flag", value: "quick" });
    expect(q.filter).toEqual({});
    expect(activeFilterCount(q.filter)).toBe(0);
  });

  it("die Ernährungsform ist eine Einzelauswahl", () => {
    const vegetarian = toggleFilter(emptyQuery, { kind: "diet", value: "vegetarian" });
    const vegan = toggleFilter(vegetarian, { kind: "diet", value: "vegan" });
    expect(vegan.filter.diets).toEqual(["vegan"]);
    expect(isFilterActive(vegan.filter, { kind: "diet", value: "vegetarian" })).toBe(false);
  });

  it("Anfrage <-> URL ist verlustfrei und unbekannte Werte werden verworfen", () => {
    const query: CatalogQuery = {
      q: "Pasta",
      filter: { mealSlots: ["BREAKFAST", "POST_WORKOUT"], diets: ["vegan"], highProtein: true, sports: ["cardio"], quick: true, mealPrep: true },
      showBlocked: true,
    };
    const url = catalogQueryToSearchParams(query);
    const parsed = parseCatalogQuery(Object.fromEntries(url.entries()));
    expect(parsed).toEqual(query);

    const hostile = parseCatalogQuery({ meal: "breakfast,<script>", diet: "carnivore", goal: "high-protein,x", flag: "quick,drop", q: "x".repeat(200) });
    expect(hostile.filter).toEqual({ mealSlots: ["BREAKFAST"], highProtein: true, quick: true });
    expect(hostile.q).toHaveLength(80);
  });

  it("ohne Parameter gilt der volle Katalog", () => {
    expect(parseCatalogQuery({})).toEqual(emptyQuery);
    expect(catalogQueryToSearchParams(emptyQuery).toString()).toBe("");
  });
});

describe("Personalisierung: bestehende Kapitel-13-Auflösung", () => {
  const peanutAllergy = { allergyLabels: ["Erdnüsse"] };

  it("Allergien verwenden dieselbe Auflösung wie der Planer (matchesAllergen), nicht einen eigenen Vergleich", () => {
    const expected = recipes.filter((r) => matchesAllergen(r.allergens, ["Erdnüsse"], r.ingredientLines)).map((r) => r.slug);
    expect(expected.length).toBeGreaterThan(0); // 'Erdnüsse' trifft das Allergen 'erdnuss' nur über die zentrale Auflösung

    const hidden = browse({}, peanutAllergy);
    expect(hidden.blockedCount).toBe(expected.length);
    expect(hidden.items.map((i) => i.recipe.slug)).toEqual(recipes.map((r) => r.slug).filter((s) => !expected.includes(s)));
    for (const slug of expected) expect(hidden.items.map((i) => i.recipe.slug)).not.toContain(slug);
  });

  it("auf Wunsch werden blockierte Rezepte gezeigt, aber klar markiert", () => {
    const shown = browse({ showBlocked: true }, peanutAllergy);
    expect(shown.items).toHaveLength(60);
    const flagged = shown.items.filter((i) => i.flags.blockedByAllergy).map((i) => i.recipe.slug);
    expect(flagged).toHaveLength(shown.blockedCount);
    expect(flagged).toContain("vegan-peanut-tofu-bowl");
  });

  it("der Allergie-Ausschluss gilt auch mit Suche und Filtern", () => {
    const result = browse({ q: "Tofu" }, peanutAllergy);
    expect(result.items.map((i) => i.recipe.slug)).not.toContain("vegan-peanut-tofu-bowl");
    expect(result.blockedCount).toBeGreaterThan(0);
  });

  it("ohne Allergien wird nichts ausgeblendet", () => {
    expect(browse({}).blockedCount).toBe(0);
  });

  it("Abneigungen blenden nicht aus (weiche Semantik), sondern markieren das Rezept mit dem Label", () => {
    const result = browse({}, { dislikedFoods: ["Paprika"] });
    expect(result.items).toHaveLength(60);
    const fajitas = result.items.find((i) => i.recipe.slug === "chicken-fajitas")!;
    expect(fajitas.flags.dislikes).toEqual(["Paprika"]);
    expect(result.items.find((i) => i.recipe.slug === "protein-pancakes-with-berries")!.flags.dislikes).toEqual([]);
  });

  it("Lieblinge werden nur gekennzeichnet, die Reihenfolge bleibt die des Katalogs", () => {
    const result = browse({}, { favoriteFoods: ["Hähnchen"] });
    expect(result.items.map((i) => i.recipe.slug)).toEqual(recipes.map((r) => r.slug));
    expect(result.items.find((i) => i.recipe.slug === "chicken-fajitas")!.flags.favorite).toBe(true);
    expect(result.items.find((i) => i.recipe.slug === "protein-pancakes-with-berries")!.flags.favorite).toBe(false);
  });

  it("Lieblinge und Abneigungen kommen aus dem gemeinsamen Präferenz-Kontext (kein zweiter Matcher)", () => {
    const preferences = { favoriteFoods: ["Hähnchen", "Reis"], dislikedFoods: ["Paprika", "Reis"] };
    const context = createFoodPreferenceContext(preferences, catalog);
    const result = browse({}, { ...preferences });
    for (const { recipe, flags } of result.items) {
      const match = context.matchFor({ id: recipe.id, ingredients: recipe.ingredientLines, structured: recipe.ingredients });
      expect(flags.favorite).toBe(isLikedHit(match));
      expect(flags.dislikes.length > 0).toBe(isDislikedHit(match));
    }
  });

  it("Regression Reis: eine Abneigung gegen 'Reis' markiert keine Reiswaffel-Rezepte", () => {
    const result = browse({}, { dislikedFoods: ["Reis"] });
    const riceCake = result.items.find((i) => i.recipe.slug === "rice-cake-protein-snack")!;
    expect(riceCake.flags.dislikes).toEqual([]);
  });
});

describe("Kachel und Detail", () => {
  const flags = { blockedByAllergy: false, dislikes: [], favorite: false };
  const row = (r: BrowseRecipe) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    imageQuery: null,
    kcal: r.kcal,
    proteinG: r.proteinG,
    carbsG: r.carbsG,
    fatG: r.fatG,
    prepTimeMin: r.timeMin,
    totalTimeMin: r.timeMin,
    servings: r.servings,
    ingredients: JSON.stringify(["veraltete Zeile"]),
    instructions: JSON.stringify(["Schritt 1"]),
    isTrending: false,
    trendSource: null,
    tags: JSON.stringify(r.tags),
  });

  it("die Zutaten des Details kommen aus den strukturierten RecipeIngredient-Zeilen", () => {
    const recipe = recipes.find((r) => r.slug === "chicken-fajitas")!;
    const card = buildCatalogCard(recipe, flags, row(recipe));
    expect(card.detail.ingredients).toEqual(recipe.ingredients.map(formatIngredientLine));
    expect(card.detail.ingredients).not.toContain("veraltete Zeile");
    expect(card.detail.ingredients.some((line) => /Paprika/.test(line))).toBe(true);
  });

  it("Detail zeigt Nährwerte, Zeit, Portionen und deutsche Kategorien; keine Personalisierungsbanner", () => {
    const recipe = recipes.find((r) => r.slug === "protein-pancakes-with-berries")!;
    const { detail } = buildCatalogCard(recipe, flags, row(recipe));
    expect(detail).toMatchObject({ name: recipe.name, prepTimeMin: recipe.timeMin, servings: recipe.servings });
    expect(detail.kcal).toBe(Math.round(recipe.kcal));
    expect(detail.proteinG).toBeCloseTo(recipe.proteinG, 1);
    expect(detail.personalization).toBeUndefined();
    expect(detail.tagLabels).toEqual(expect.arrayContaining(["Vegetarisch", "Proteinreich", "Frühstück", "Schnell"]));
    expect(detail.tagLabels).not.toContain("Mischkost");
  });

  it("Regression: das bestehende Detail eigener Rezepte bleibt unverändert (keine Kategorien, Zutaten aus dem Freitext)", () => {
    const recipe = recipes[0];
    const custom = { ...row(recipe), imageQuery: null, ingredients: JSON.stringify(["2 Eier", "1 Prise Salz"]), tags: JSON.stringify(["vegan"]) };
    const detail = dbRecipeToDetail(custom);
    expect(detail.ingredients).toEqual(["2 Eier", "1 Prise Salz"]);
    expect(detail.tagLabels).toBeUndefined();
    expect(detail.tags).toEqual(["vegan"]);
  });

  it("die Karte zeigt Name, genau eine Einordnung und die Kerndaten mit unveränderten Nährwerten", () => {
    const recipe = recipes.find((r) => r.slug === "protein-pancakes-with-berries")!;
    const card = buildCatalogCard(recipe, flags, row(recipe));
    expect(card).toMatchObject({ name: recipe.name, kcal: recipe.kcal, proteinG: recipe.proteinG, timeMin: recipe.timeMin });
    expect(card.type).toEqual({ key: "breakfast", label: "Frühstück" });
    // Die Karte trägt bewusst keine Makros/Tags mehr, das Detail dagegen alles.
    expect(card).not.toHaveProperty("tags");
    expect(card).not.toHaveProperty("carbsG");
    expect(card.detail).toMatchObject({ kcal: Math.round(recipe.kcal), category: { key: "breakfast", label: "Frühstück" } });
    expect(card.detail.carbsG).toBeCloseTo(recipe.carbsG, 1);
    expect(card.detail.fatG).toBeCloseTo(recipe.fatG, 1);
  });

  it("jedes der 60 Katalog-Rezepte bekommt genau einen erkennbaren Typ, keiner fällt auf das Fallback", () => {
    for (const r of recipes) {
      const { type } = buildCatalogCard(r, flags, row(r));
      expect(type.key, r.slug).not.toBe("other");
    }
  });
});

describe("Karten-Hinweis (Platz für spätere Hinweise)", () => {
  const base = { blockedByAllergy: false, dislikes: [] as string[], favorite: false };

  it("kein Hinweis ohne Markierung", () => {
    expect(cardHint(base)).toBeNull();
  });

  it("Allergie vor Abneigung vor Lieblingsessen, immer nur ein Hinweis", () => {
    expect(cardHint({ blockedByAllergy: true, dislikes: ["Paprika"], favorite: true })).toEqual({ kind: "allergy", text: "Enthält Allergene aus deinem Profil" });
    expect(cardHint({ ...base, dislikes: ["Paprika", "Rosenkohl"], favorite: true })).toEqual({ kind: "dislike", text: "Enthält Paprika, Rosenkohl, das du nicht magst" });
    expect(cardHint({ ...base, favorite: true })).toEqual({ kind: "favorite", text: "Mit einem deiner Lieblingsessen" });
  });

  it("die Karte übernimmt den Hinweis aus den bestehenden Präferenz-Markierungen", () => {
    const result = browse({}, { dislikedFoods: ["Paprika"], favoriteFoods: ["Hähnchen"], allergyLabels: ["Erdnüsse"] });
    const cards = result.items.map((i) => buildCatalogCard(i.recipe, i.flags, toRow(i.recipe)));
    expect(cards.find((c) => c.id === "chicken-fajitas")!.hint).toMatchObject({ kind: "dislike" });
    expect(cards.find((c) => c.id === "chicken-teriyaki-rice-bowl")!.hint).toMatchObject({ kind: "favorite" });
    expect(cards.find((c) => c.id === "protein-pancakes-with-berries")!.hint).toBeNull();
  });
});

describe("Entdecken: Bereiche der Standardansicht", () => {
  const toCard = (recipe: BrowseRecipe, flags: ReturnType<typeof browse>["items"][number]["flags"]) =>
    buildCatalogCard(recipe, flags, {
      id: recipe.id, name: recipe.name, description: recipe.description, imageQuery: null, kcal: recipe.kcal, proteinG: recipe.proteinG,
      carbsG: recipe.carbsG, fatG: recipe.fatG, prepTimeMin: recipe.timeMin, totalTimeMin: recipe.timeMin, servings: recipe.servings,
      ingredients: "[]", instructions: "[]", isTrending: false, trendSource: null, tags: JSON.stringify(recipe.tags),
    });
  const sectionsFor = (preferences: Partial<BrowsePreferences> = {}) => buildDiscoverSections(browse({}, preferences).items, toCard);

  it("ohne Lieblinge gibt es keinen 'Für dich'-Bereich (keine erfundene Empfehlung)", () => {
    expect(sectionsFor().map((s) => s.id)).not.toContain("for-you");
  });

  it("'Für dich' entsteht nur aus Rezepten mit Lieblingsfood und ohne Abneigung, höchstens drei, in Katalogreihenfolge", () => {
    const section = sectionsFor({ favoriteFoods: ["Hähnchen"], dislikedFoods: ["Paprika"] }).find((s) => s.id === "for-you")!;
    expect(section.variant).toBe("featured");
    expect(section.cards.length).toBeLessThanOrEqual(3);
    expect(section.total).toBeGreaterThan(3);
    for (const card of section.cards) {
      expect(card.flags.favorite).toBe(true);
      expect(card.flags.dislikes).toEqual([]);
    }
    expect(section.cards.map((c) => c.id)).not.toContain("chicken-fajitas"); // Hähnchen, aber Paprika
    const order = recipes.map((r) => r.slug);
    const positions = section.cards.map((c) => order.indexOf(c.id));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("'Schnell gemacht' nutzt den bestehenden Schnell-Filter", () => {
    const quick = sectionsFor().find((s) => s.id === "quick")!;
    expect(quick.variant).toBe("compact");
    expect(quick.total).toBe(filterRecipes(recipes, { quick: true }).length);
    expect(quick.more).toEqual({ q: "", filter: { quick: true }, showBlocked: false });
    for (const card of quick.cards) expect(filterRecipes(recipes.filter((r) => r.id === card.id), { quick: true })).toHaveLength(1);
  });

  it("je Rezepttyp ein Bereich; 'Alle anzeigen' öffnet den passenden bestehenden Mahlzeit-Filter", () => {
    const sections = sectionsFor();
    expect(sections.filter((s) => s.variant === "standard").map((s) => s.id)).toEqual(["breakfast", "meal", "snack", "pre-workout", "post-workout"]);
    const meal = sections.find((s) => s.id === "meal")!;
    expect(meal.more?.filter).toEqual({ mealSlots: ["LUNCH", "DINNER"] });
    expect(meal.total).toBe(filterRecipes(recipes, { mealSlots: ["LUNCH", "DINNER"] }).length);
    expect(meal.cards.length).toBeLessThanOrEqual(6);
    for (const card of meal.cards) expect(card.type.key).toBe("meal");
  });

  it("nichts geht verloren: jedes Rezept ist über einen Bereich oder dessen 'Alle anzeigen' erreichbar", () => {
    const reachable = new Set<string>();
    for (const section of sectionsFor().filter((s) => s.variant === "standard")) {
      for (const r of filterRecipes(recipes, section.more?.filter ?? {})) reachable.add(r.slug);
    }
    expect(reachable.size).toBe(60);
  });

  it("wegen Allergien ausgeblendete Rezepte tauchen in keinem Bereich auf", () => {
    const sections = sectionsFor({ allergyLabels: ["Erdnüsse"] });
    const ids = sections.flatMap((s) => s.cards.map((c) => c.id));
    expect(ids).not.toContain("vegan-peanut-tofu-bowl");
  });
});

describe("Karten ohne Anfangsbuchstaben", () => {
  it("die Karten des Katalogs verwenden weder RecipeThumb noch den Namensbuchstaben als visuelles Element", () => {
    for (const file of ["src/app/recipes/RecipeCards.tsx", "src/app/recipes/CatalogBrowser.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/RecipeThumb/);
      expect(source, file).not.toMatch(/charAt\(0\)/);
    }
  });
});
