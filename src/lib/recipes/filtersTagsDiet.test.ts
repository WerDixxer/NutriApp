import { describe, expect, it } from "vitest";
import { buildRecipes, buildSeedCatalog, toStructuredIngredients } from "./data/build";
import { RECIPES } from "./data/recipes";
import { deriveAllergens, deriveDietClass, dietTypesFor } from "./diet";
import { filterRecipes, type FilterableRecipe } from "./filters";
import { mealSlotsFromTags, normalizeTag, primaryCategory, sportsFromTags, tagGroup, tagsInGroup } from "./tags";

const catalog = buildSeedCatalog();
const built = buildRecipes(catalog);

const filterable = built.map((r) => ({
  slug: r.slug,
  mealSlots: r.mealSlots,
  dietTypes: r.dietTypes,
  tags: r.tags,
  kcal: r.nutrition.kcal,
  proteinG: r.nutrition.proteinG,
  timeMin: r.totalTimeMin,
  mealPrepSuitable: r.mealPrepSuitable,
})) satisfies (FilterableRecipe & { slug: string })[];

const slugs = (list: { slug: string }[]) => list.map((r) => r.slug);

describe("Tag-Registry", () => {
  it("ordnet Tags den Gruppen dietary/goal/meal/sport/time zu", () => {
    expect(tagGroup("vegan")).toBe("dietary");
    expect(tagGroup("keto")).toBe("dietary");
    expect(tagGroup("high-protein")).toBe("goal");
    expect(tagGroup("breakfast")).toBe("meal");
    expect(tagGroup("pre-football")).toBe("sport");
    expect(tagGroup("recovery")).toBe("sport");
    expect(tagGroup("quick")).toBe("time");
    expect(tagGroup("meal-prep")).toBe("practical");
    expect(tagGroup("social-media-trend")).toBe("other");
  });

  it("bildet ältere deutsche Tags auf die kanonische Form ab", () => {
    expect(normalizeTag("Vegetarisch")).toBe("vegetarian");
    expect(normalizeTag("schnell")).toBe("quick");
    expect(tagGroup("vegetarisch")).toBe("dietary");
  });

  it("leitet Mahlzeiten-Slots aus Tags ab, auch aus sportartspezifischen (post-football)", () => {
    expect(mealSlotsFromTags(["vegetarian", "breakfast", "snack"]).sort()).toEqual(["BREAKFAST", "SNACK"]);
    expect(mealSlotsFromTags(["omnivore", "post-football", "recovery"])).toEqual(["POST_WORKOUT"]);
    expect(mealSlotsFromTags(["pre-strength"])).toEqual(["PRE_WORKOUT"]);
    expect(mealSlotsFromTags(["dessert"])).toEqual(["SNACK"]);
    expect(mealSlotsFromTags(["vegan", "quick"])).toEqual([]);
  });

  it("erkennt Sportarten und die Hauptkategorie", () => {
    expect(sportsFromTags(["pre-football", "post-strength", "pre-cardio"]).sort()).toEqual(["cardio", "football", "strength"]);
    expect(sportsFromTags(["breakfast"])).toEqual([]);
    expect(primaryCategory(["vegetarian", "dessert", "snack"])).toBe("dessert");
    expect(primaryCategory(["omnivore", "post-football", "recovery"])).toBe("post-workout");
    expect(tagsInGroup(["Vegan", "quick", "lunch"], "dietary")).toEqual(["vegan"]);
  });
});

describe("Diät-Ableitung", () => {
  const ing = (slug: string) => toStructuredIngredients({ ...RECIPES[0], ingredients: [{ food: slug }] })[0];

  it("nimmt die restriktivste Klasse aller Zutaten", () => {
    expect(deriveDietClass([ing("tofu"), ing("reis")], catalog)).toBe("vegan");
    expect(deriveDietClass([ing("tofu"), ing("honig")], catalog)).toBe("vegetarian");
    expect(deriveDietClass([ing("tofu"), ing("lachs")], catalog)).toBe("pescatarian");
    expect(deriveDietClass([ing("lachs"), ing("haehnchenbrust")], catalog)).toBe("omnivore");
  });

  it("behandelt unbekannte Foods konservativ als omnivore", () => {
    expect(deriveDietClass([{ ...ing("tofu"), foodId: "unbekannt" }], catalog)).toBe("omnivore");
  });

  it("baut dietTypes im Vokabular des bestehenden Schemas, ohne HALAL/KOSHER zu behaupten", () => {
    expect(dietTypesFor("vegan", [])).toEqual(["OMNIVORE", "PESCETARIAN", "VEGETARIAN", "VEGAN"]);
    expect(dietTypesFor("omnivore", ["keto"])).toEqual(["OMNIVORE", "KETO", "LOW_CARB"]);
    expect(dietTypesFor("pescatarian", ["low-carb"])).toEqual(["OMNIVORE", "PESCETARIAN", "LOW_CARB"]);
    expect(dietTypesFor("vegetarian", [])).not.toContain("HALAL");
  });

  it("vereinigt Allergene der Foods", () => {
    expect(deriveAllergens([ing("skyr"), ing("erdnussbutter"), ing("skyr")], catalog)).toEqual(["erdnuss", "milch"]);
    expect(deriveAllergens([ing("banane")], catalog)).toEqual([]);
  });
});

describe("filterRecipes: alle Filter des Auftrags über die Seed-Rezepte", () => {
  it("filtert nach Mahlzeit: Frühstück, Mittag, Abend, Snack, Dessert, Pre-/Post-Workout", () => {
    expect(slugs(filterRecipes(filterable, { mealSlots: ["BREAKFAST"] }))).toEqual(
      expect.arrayContaining(["protein-pancakes-with-berries", "overnight-oats-apple-cinnamon", "tofu-scramble"]),
    );
    expect(filterRecipes(filterable, { mealSlots: ["LUNCH"] }).length).toBeGreaterThan(10);
    expect(filterRecipes(filterable, { mealSlots: ["DINNER"] }).length).toBeGreaterThan(10);
    expect(slugs(filterRecipes(filterable, { mealSlots: ["SNACK"] }))).toContain("protein-energy-balls");
    expect(slugs(filterRecipes(filterable, { dessert: true }))).toEqual(["protein-chocolate-pudding"]);
    expect(filterRecipes(filterable, { mealSlots: ["PRE_WORKOUT"] }).length).toBeGreaterThanOrEqual(16);
    expect(filterRecipes(filterable, { mealSlots: ["POST_WORKOUT"] }).length).toBeGreaterThanOrEqual(13);
  });

  it("filtert vegetarisch, vegan und pescetarisch nach Zutaten, nicht nur nach Tag", () => {
    const vegan = slugs(filterRecipes(filterable, { diets: ["vegan"] }));
    expect(vegan).toEqual(expect.arrayContaining(["tofu-scramble", "vegan-tofu-stir-fry", "dates-and-banana", "veggie-burrito"]));
    expect(vegan).not.toContain("homemade-sports-drink");
    expect(vegan).not.toContain("chicken-fajitas");

    const vegetarian = slugs(filterRecipes(filterable, { diets: ["vegetarian"] }));
    expect(vegetarian).toEqual(expect.arrayContaining(["keto-omelette", "homemade-sports-drink"]));
    expect(vegetarian).not.toContain("salmon-avocado-bowl");

    const pescatarian = slugs(filterRecipes(filterable, { diets: ["pescatarian"] }));
    expect(pescatarian).toEqual(expect.arrayContaining(["salmon-avocado-bowl", "tuna-toast", "keto-omelette"]));
    expect(pescatarian).not.toContain("chicken-burrito-bowl");
  });

  it("filtert proteinreich, kalorienarm, Low Carb, Keto, ballaststoffreich, Meal Prep, schnell, günstig", () => {
    expect(slugs(filterRecipes(filterable, { keto: true })).sort()).toEqual(
      ["keto-chicken-alfredo", "keto-omelette", "salmon-avocado-bowl"].sort(),
    );
    expect(slugs(filterRecipes(filterable, { lowCarb: true }))).toEqual(
      expect.arrayContaining(["chicken-avocado-salad", "keto-omelette"]),
    );
    expect(slugs(filterRecipes(filterable, { lowCalorie: true }))).toEqual(expect.arrayContaining(["chicken-caesar-light", "tuna-salad-bowl"]));
    expect(slugs(filterRecipes(filterable, { highFiber: true }))).toEqual(expect.arrayContaining(["turkey-chili", "veggie-burrito"]));
    expect(slugs(filterRecipes(filterable, { mealPrep: true }))).toEqual(
      expect.arrayContaining(["overnight-oats-apple-cinnamon", "turkey-chili", "chicken-recovery-bowl"]),
    );
    expect(slugs(filterRecipes(filterable, { budgetFriendly: true }))).toEqual(
      expect.arrayContaining(["veggie-burrito", "vegan-chickpea-curry", "turkey-chili"]),
    );
    expect(filterRecipes(filterable, { highProtein: true }).length).toBeGreaterThan(30);
    for (const r of filterRecipes(filterable, { quick: true })) expect(r.timeMin).toBeLessThanOrEqual(20);
  });

  it("filtert nach Sportart: Fußball, Krafttraining, Cardio", () => {
    const football = slugs(filterRecipes(filterable, { sports: ["football"] }));
    expect(football).toEqual(expect.arrayContaining(["banana-with-honey", "football-energy-snack", "football-recovery-bowl"]));
    expect(football).not.toContain("protein-banana-shake");
    expect(slugs(filterRecipes(filterable, { sports: ["strength"] }))).toEqual(
      expect.arrayContaining(["banana-and-skyr", "post-workout-protein-pasta"]),
    );
    expect(slugs(filterRecipes(filterable, { sports: ["cardio"] }))).toEqual(
      expect.arrayContaining(["applesauce-and-rice-cakes", "chicken-recovery-bowl"]),
    );
  });

  it("filtert nach Kalorien-, Protein- und Zeitbereich und kombiniert Filter", () => {
    for (const r of filterRecipes(filterable, { kcal: { min: 300, max: 450 } })) {
      expect(r.kcal).toBeGreaterThanOrEqual(300);
      expect(r.kcal).toBeLessThanOrEqual(450);
    }
    for (const r of filterRecipes(filterable, { protein: { min: 40 } })) expect(r.proteinG).toBeGreaterThanOrEqual(40);
    for (const r of filterRecipes(filterable, { maxTimeMin: 10 })) expect(r.timeMin).toBeLessThanOrEqual(10);

    const combined = filterRecipes(filterable, { diets: ["vegetarian"], mealSlots: ["BREAKFAST"], highProtein: true, quick: true });
    expect(slugs(combined)).toEqual(expect.arrayContaining(["protein-pancakes-with-berries", "protein-yogurt-bowl"]));
    // Ein veganes Frühstück passt auch zur vegetarischen Ernährung.
    expect(slugs(combined)).toContain("tofu-scramble");
    // Nicht-Frühstück und Fleischgerichte fallen heraus.
    expect(slugs(combined)).not.toContain("chicken-fajitas");
    expect(slugs(combined)).not.toContain("banana-with-honey");
  });

  it("liefert ohne Filter alle 60 und bei unerfüllbarer Kombination nichts", () => {
    expect(filterRecipes(filterable, {})).toHaveLength(60);
    expect(filterRecipes(filterable, { diets: ["vegan"], keto: true, protein: { min: 100 } })).toEqual([]);
  });
});
