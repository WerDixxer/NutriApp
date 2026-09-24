import { describe, expect, it } from "vitest";
import { RECIPE_TYPE_ICONS, RECIPE_TYPE_TONES } from "../../components/RecipeTypeIcon";
import { buildRecipes, buildSeedCatalog } from "./data/build";
import { RECIPE_TYPE_ORDER, RECIPE_TYPES, recipeType } from "./recipeType";

const built = buildRecipes(buildSeedCatalog());
const type = (mealSlots: string[], tags: string[] = []) => recipeType({ mealSlots, tags });

describe("Rezepttyp aus vorhandenen Daten", () => {
  it("Frühstück erhält das Frühstücks-Icon", () => {
    expect(type(["BREAKFAST"], ["breakfast"])).toEqual({ key: "breakfast", label: "Frühstück", icon: "Sunrise" });
  });

  it("Snack erhält das Snack-Icon", () => {
    expect(type(["SNACK"], ["snack"])).toEqual({ key: "snack", label: "Snack", icon: "Apple" });
  });

  it("Training-Rezepte erhalten Energie- bzw. Training-Icon", () => {
    expect(type(["PRE_WORKOUT"], ["pre-strength"])).toEqual({ key: "pre-workout", label: "Vor dem Training", icon: "Zap" });
    expect(type(["POST_WORKOUT"], ["post-football", "recovery"])).toEqual({ key: "post-workout", label: "Nach dem Training", icon: "Dumbbell" });
  });

  it("Mittag und Abend sind zusammen eine 'Vollwertige Mahlzeit', keine erzwungene Mittag-/Abend-Kategorie", () => {
    expect(type(["LUNCH", "DINNER"], ["lunch", "dinner"])).toEqual({ key: "meal", label: "Vollwertige Mahlzeit", icon: "Utensils" });
    expect(type(["DINNER"], ["dinner"]).key).toBe("meal");
  });

  it("ohne passende Kategorie gibt es das neutrale Fallback-Icon", () => {
    expect(type([], [])).toEqual({ key: "other", label: "Rezept", icon: "ChefHat" });
    expect(type([], ["vegan", "quick"]).key).toBe("other");
    expect(type(["SOMETHING_ELSE"], []).key).toBe("other");
  });

  it("ohne Slot entscheidet der passende Rezept-Tag", () => {
    expect(type([], ["vegetarian", "breakfast"]).key).toBe("breakfast");
    expect(type([], ["dessert"]).key).toBe("snack");
    expect(type([], ["post-cardio"]).key).toBe("post-workout");
  });

  it("bei mehreren Slots entscheidet die Hauptkategorie (erster Meal-Tag), nie zwei Typen gleichzeitig", () => {
    expect(type(["BREAKFAST", "POST_WORKOUT"], ["post-workout", "breakfast"]).key).toBe("post-workout");
    expect(type(["BREAKFAST", "POST_WORKOUT"], ["breakfast", "post-workout"]).key).toBe("breakfast");
    expect(type(["BREAKFAST", "SNACK"], ["breakfast", "snack"]).key).toBe("breakfast");
  });

  it("bei mehreren Slots ohne passenden Tag gilt eine feste Rangfolge (deterministisch, unabhängig von der Slot-Reihenfolge)", () => {
    expect(type(["BREAKFAST", "PRE_WORKOUT"], []).key).toBe("pre-workout");
    expect(type(["PRE_WORKOUT", "BREAKFAST"], []).key).toBe("pre-workout");
    expect(type(["SNACK", "LUNCH"], []).key).toBe("meal");
  });
});

describe("Rezepttyp der 60 Katalog-Rezepte", () => {
  const typed = built.map((r) => ({ slug: r.slug, type: recipeType(r) }));

  it("jedes Rezept hat genau einen Typ, keines fällt auf das Fallback", () => {
    expect(typed).toHaveLength(60);
    for (const { slug, type: t } of typed) expect(t.key, slug).not.toBe("other");
  });

  it("die Typen decken die vorhandene Vielfalt ab", () => {
    const keys = new Set(typed.map((t) => t.type.key));
    for (const key of RECIPE_TYPE_ORDER) expect(keys.has(key), key).toBe(true);
  });

  it("konkrete Beispiele", () => {
    const byslug = Object.fromEntries(typed.map((t) => [t.slug, t.type.key]));
    expect(byslug["protein-pancakes-with-berries"]).toBe("breakfast");
    expect(byslug["chicken-teriyaki-rice-bowl"]).toBe("meal");
    expect(byslug["protein-energy-balls"]).toBe("snack");
    expect(byslug["skyr-banana-bowl"]).toBe("post-workout"); // Frühstück + Nach dem Training: Hauptkategorie
  });
});

describe("Icon-System", () => {
  it("jeder Typ hat ein lucide-Icon und eine Fläche aus den Design-Tokens", () => {
    for (const t of Object.values(RECIPE_TYPES)) {
      expect(RECIPE_TYPE_ICONS[t.icon], t.key).toBeDefined();
      expect(RECIPE_TYPE_TONES[t.key], t.key).toMatch(/^var\(--color-/);
    }
  });

  it("die Typen haben unterschiedliche Icons (außer dem Fallback ist nichts doppelt)", () => {
    const icons = Object.values(RECIPE_TYPES).map((t) => t.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
