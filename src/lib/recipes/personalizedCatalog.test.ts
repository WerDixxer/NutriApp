import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RecipeDetailContent, type RecipeDetail } from "../../components/RecipeDetailModal";
import {
  browseCatalog,
  buildCatalogCard,
  buildDiscoverSections,
  cardHint,
  type BrowsePreferences,
  type BrowseRecipe,
  type CatalogQuery,
} from "./catalogBrowser";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { availableVariant, detailView, nutritionSummary, replacementRows, variantTeaser } from "./variantView";
import { formatIngredientLine } from "./units";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);
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

const query: CatalogQuery = { q: "", filter: {}, showBlocked: true };
const none: BrowsePreferences = { allergyLabels: [], favoriteFoods: [], dislikedFoods: [] };
const browse = (prefs: Partial<BrowsePreferences>, q: Partial<CatalogQuery> = {}) => browseCatalog(recipes, { ...query, ...q }, { ...none, ...prefs }, catalog);

const rowOf = (r: BrowseRecipe) => ({
  id: r.id, name: r.name, description: r.description, imageQuery: null, kcal: r.kcal, proteinG: r.proteinG, carbsG: r.carbsG, fatG: r.fatG,
  prepTimeMin: r.timeMin, totalTimeMin: r.timeMin, servings: r.servings, ingredients: "[]", instructions: JSON.stringify(["Schritt 1"]),
  isTrending: false, trendSource: null, tags: JSON.stringify(r.tags),
});

/** Karte für ein Rezept unter den gegebenen Präferenzen, so wie die Seite sie baut. */
function cardFor(slug: string, prefs: Partial<BrowsePreferences>) {
  const item = browse(prefs).items.find((i) => i.recipe.slug === slug)!;
  return { item, card: buildCatalogCard(item.recipe, item.flags, rowOf(item.recipe), item.variant) };
}

const PANCAKES = "protein-pancakes-with-berries";

describe("Katalog: Variante je Rezept", () => {
  it("abgelehntes Skyr macht die Pancakes 'anpassbar', das Original bleibt unverändert", () => {
    const { item, card } = cardFor(PANCAKES, { dislikedFoods: ["Skyr"] });
    expect(item.flags.adaptable).toBe(true);
    expect(item.variant?.replacements).toEqual([{ fromName: "Skyr", toName: "Magerquark", quantity: "100 g", reason: "disliked_food" }]);
    expect(card.detail.ingredients).toContain("100 g Skyr"); // Original
    expect(card.detail.variant?.ingredientLines).toContain("100 g Magerquark");
    expect(card.detail.kcal).toBe(Math.round(recipes.find((r) => r.slug === PANCAKES)!.kcal));
  });

  it("ohne Präferenzen gibt es keine Variante und keine Auswahl: normale Detailansicht", () => {
    const result = browse({});
    for (const item of result.items) {
      expect(item.variant).toBeNull();
      expect(item.flags.adaptable).toBe(false);
    }
    const { card } = cardFor(PANCAKES, {});
    expect(card.detail).not.toHaveProperty("variant");
    expect(card.hint).toBeNull();
  });

  it("ein Rezept ohne gültige Alternative bekommt keine Variante (Paprika in den Fajitas)", () => {
    const { item, card } = cardFor("chicken-fajitas", { dislikedFoods: ["Paprika"] });
    expect(item.variant).toBeNull();
    expect(card.detail).not.toHaveProperty("variant");
    expect(card.hint).toMatchObject({ kind: "dislike" });
  });

  it("nur Rezepte mit einer tatsächlich gültigen Ersetzung sind 'anpassbar'", () => {
    const result = browse({ dislikedFoods: ["Skyr"] });
    const adaptable = result.items.filter((i) => i.flags.adaptable).map((i) => i.recipe.slug);
    expect(adaptable.length).toBeGreaterThan(0);
    for (const slug of adaptable) expect(recipes.find((r) => r.slug === slug)!.ingredients.some((i) => i.foodId === "skyr")).toBe(true);
    for (const item of result.items) expect(item.flags.adaptable).toBe(item.variant !== null);
  });

  it("Allergie-Fall über die Kapitel-13-Auflösung: Erdnuss-Allergie bietet Mandelmus an, Nuss-Allergie nichts", () => {
    const peanut = built.find((r) => r.ingredients.some((i) => i.foodId === "erdnussbutter"))!.slug;
    const onlyPeanut = cardFor(peanut, { allergyLabels: ["Erdnüsse"] });
    expect(onlyPeanut.item.variant?.replacements[0]).toMatchObject({ fromName: "Erdnussbutter", toName: "Mandelmus", reason: "allergen" });
    expect(onlyPeanut.item.variant?.stillBlockedByAllergy).toBe(false);
    expect(onlyPeanut.item.flags.blockedByAllergy).toBe(true); // das Original bleibt gesperrt

    const nuts = cardFor(peanut, { allergyLabels: ["Erdnüsse", "Nüsse"] });
    expect(nuts.item.variant).toBeNull();
    expect(nuts.item.flags.blockedByAllergy).toBe(true);
  });

  it("die Suche, die Filter und die Reihenfolge des Katalogs bleiben von der Personalisierung unberührt", () => {
    const withPrefs = browse({ dislikedFoods: ["Skyr"], favoriteFoods: ["Magerquark"] }, { showBlocked: false });
    const without = browse({}, { showBlocked: false });
    expect(withPrefs.items.map((i) => i.recipe.slug)).toEqual(without.items.map((i) => i.recipe.slug));
  });
});

describe("Karten-Hinweis", () => {
  it("'Für dich anpassbar' erscheint nur bei einer echten Variante", () => {
    expect(cardFor(PANCAKES, { dislikedFoods: ["Skyr"] }).card.hint).toEqual({ kind: "adapted", text: "Für dich anpassbar" });
    expect(cardFor("chicken-fajitas", { dislikedFoods: ["Paprika"] }).card.hint?.kind).toBe("dislike");
  });

  it("Rangfolge: Allergie vor 'anpassbar' vor Abneigung vor Lieblingsessen", () => {
    const base = { blockedByAllergy: false, dislikes: ["Skyr"], favorite: true, adaptable: true };
    expect(cardHint({ ...base, blockedByAllergy: true })?.kind).toBe("allergy");
    expect(cardHint(base)?.kind).toBe("adapted");
    expect(cardHint({ ...base, adaptable: false })?.kind).toBe("dislike");
    expect(cardHint({ ...base, adaptable: false, dislikes: [] })?.kind).toBe("favorite");
  });

  it("die Bereiche der Standardansicht bleiben unverändert ('Für dich' nur mit Lieblingsfood ohne Abneigung)", () => {
    const items = browse({ dislikedFoods: ["Skyr"], favoriteFoods: ["Hähnchen"] }, { showBlocked: false }).items;
    const sections = buildDiscoverSections(items, (r, f) => buildCatalogCard(r, f, rowOf(r)));
    const forYou = sections.find((s) => s.id === "for-you")!;
    for (const card of forYou.cards) expect(card.flags.dislikes).toEqual([]);
  });
});

describe("Detailansicht: Auswahl Original / Für dich angepasst", () => {
  const { card } = cardFor(PANCAKES, { dislikedFoods: ["Skyr", "Haferflocken"] });
  const detail: RecipeDetail = card.detail;
  const plain: RecipeDetail = cardFor(PANCAKES, {}).card.detail;

  const render = (recipe: RecipeDetail, personalized: boolean, onChange = vi.fn()) =>
    renderToStaticMarkup(createElement(RecipeDetailContent, { recipe, titleId: "t", personalized, onPersonalizedChange: onChange }));

  it("'Für dich anpassen' erscheint nur, wenn ein gültiges Replacement existiert", () => {
    expect(availableVariant(detail)).not.toBeNull();
    expect(availableVariant(plain)).toBeNull();
    expect(availableVariant({ variant: { ...detail.variant!, replacements: [] } })).toBeNull();

    expect(render(detail, false)).toContain("Für dich anpassen");
    expect(render(plain, false)).not.toContain("Für dich anpassen");
    expect(render({ ...detail, variant: { ...detail.variant!, replacements: [] } }, false)).not.toContain("Für dich anpassen");
  });

  it("ohne Personalisierung ist es die normale Detailansicht (kein Angebot, kein Hinweis, Original-Zutaten)", () => {
    const html = render(plain, false);
    expect(html).not.toContain("angepasst");
    expect(html).not.toContain("Original anzeigen");
    expect(html).toContain("100 g Skyr");
  });

  it("die Originalansicht zeigt das Original und nur ein Angebot; nichts wird automatisch geändert", () => {
    const html = render(detail, false);
    expect(html).toContain("100 g Skyr");
    expect(html).toContain("40 g Haferflocken");
    expect(html).not.toContain("100 g Magerquark");
    expect(html).toContain("Möglich: ");
    expect(html).not.toContain("Für dich angepasst");
  });

  it("die angepasste Ansicht zeigt Ersetzungen, Mengen, Grund, neue Zutaten und neue Nährwerte", () => {
    const html = render(detail, true);
    expect(html).toContain("Für dich angepasst");
    expect(html).toContain("Skyr → Magerquark");
    expect(html).toContain("Haferflocken → Dinkelflocken");
    expect(html).toContain("100 g → 100 g");
    expect(html).toContain("40 g → 40 g");
    expect(html).toContain("Du magst Skyr nicht");
    expect(html).toContain("100 g Magerquark");
    expect(html).toContain("40 g Dinkelflocken");
    expect(html).toContain("Original anzeigen");
    expect(html).toContain(nutritionSummary(detail.variant!));
    expect(html).toContain(`Original: ${nutritionSummary(detail)}`);
  });

  it("(Zutatenliste) die angepasste Ansicht enthält das Original-Skyr nicht mehr, die Originalansicht das Magerquark nicht", () => {
    const personalized = detailView(detail, true);
    expect(personalized.ingredients).toContain("100 g Magerquark");
    expect(personalized.ingredients).not.toContain("100 g Skyr");
    const original = detailView(detail, false);
    expect(original.ingredients).toContain("100 g Skyr");
    expect(original.ingredients).not.toContain("100 g Magerquark");
  });

  it("die Nährwerte der Ansicht wechseln mit der Wahl; ohne Variante gilt immer das Original", () => {
    const original = detailView(detail, false);
    const personalized = detailView(detail, true);
    expect(original.kcal).toBe(detail.kcal);
    expect(personalized.kcal).toBe(detail.variant!.kcal);
    expect(personalized.kcal).not.toBe(original.kcal);
    expect(detailView(plain, true)).toEqual(detailView(plain, false));
  });

  it("der Nutzer kann wechseln: die Buttons lösen die Auswahl aus", () => {
    const onChange = vi.fn();
    const click = (tree: ReactNode, label: string) => {
      const found = findButton(expand(tree), label);
      expect(found, label).toBeDefined();
      found!.props.onClick();
    };
    click(RecipeDetailContent({ recipe: detail, titleId: "t", personalized: false, onPersonalizedChange: onChange }), "Für dich anpassen");
    expect(onChange).toHaveBeenLastCalledWith(true);
    click(RecipeDetailContent({ recipe: detail, titleId: "t", personalized: true, onPersonalizedChange: onChange }), "Original anzeigen");
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("eine Variante, die noch Allergene enthält, wird nicht als sicher dargestellt", () => {
    const risky = { ...detail, variant: { ...detail.variant!, stillBlockedByAllergy: true } };
    expect(render(risky, true)).toContain("enthält noch Allergene");
    expect(render(detail, true)).not.toContain("enthält noch Allergene");
  });

  it("Replacement-Hinweise: Zeilen, Teaser und Gründe", () => {
    const rows = replacementRows(detail.variant!);
    expect(rows.find((r) => r.title === "Skyr → Magerquark")).toEqual({ title: "Skyr → Magerquark", quantity: "100 g → 100 g", reason: "Du magst Skyr nicht" });
    expect(variantTeaser(detail.variant!)).toMatch(/^Möglich: /);
    expect(variantTeaser(detail.variant!)).toContain("Magerquark statt Skyr");
    expect(variantTeaser(detail.variant!)).toContain("Dinkelflocken statt Haferflocken");
    const allergy = cardFor(built.find((r) => r.ingredients.some((i) => i.foodId === "erdnussbutter"))!.slug, { allergyLabels: ["Erdnüsse"] }).card.detail.variant!;
    expect(replacementRows(allergy)[0].reason).toBe("Wegen deiner Allergie oder Unverträglichkeit");
  });

  it("Regression: bestehende Personalisierungs-Banner (Planer/Dashboard) funktionieren unverändert", () => {
    const withBanner = { ...plain, personalization: { swaps: [{ from: "Skyr", to: "Magerquark" }] } };
    expect(render(withBanner, false)).toContain("Magerquark statt Skyr");
  });
});

// ---- Hilfen: React-Elementbaum ohne DOM durchlaufen (Komponenten expandieren) ----

function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  if (typeof element.type === "function") {
    return expand((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return { ...element, props: { ...element.props, children: expand(element.props.children) } } as ReactElement;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf((node as ReactElement<{ children?: ReactNode }>).props?.children);
}

function findButton(node: ReactNode, label: string): ReactElement<{ onClick: () => void }> | undefined {
  if (Array.isArray(node)) return node.map((n) => findButton(n, label)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.type === "button" && textOf(element).trim() === label) return element as ReactElement<{ onClick: () => void }>;
  return findButton(element.props.children, label);
}
