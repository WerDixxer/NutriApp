import { beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, fromDbDate, type CalendarDate } from "./calendarDate";
import type { RecipeUsage } from "./generateMealPlan";

// Kleine In-Memory-Nachbildung der vier verwendeten Prisma-Aufrufe, damit die
// echte Generierungslogik (Reihenfolge, Wochenverwendung, Speicherung) läuft.
interface StoredItem {
  id: string;
  slot: string;
  time: string;
  recipeId: string;
  portionMultiplier: number;
  recipe: FakeRecipe;
}
interface StoredDay {
  id: string;
  profileId: string;
  date: Date;
  targetKcal?: number;
  targetProteinG?: number;
  targetCarbsG?: number;
  targetFatG?: number;
  items: StoredItem[];
}
interface FakeRecipe {
  id: string;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealSlots: string;
  ingredients: string;
  instructions: string;
  dietTypes: string;
  allergens: string;
  isTrending: boolean;
  isCustom: boolean;
  ownerProfileId: string | null;
}

let store: StoredDay[] = [];
/** Kalendertage der neu gespeicherten Tagespläne, in Speicherreihenfolge. */
let createdDays: CalendarDate[] = [];
let recipes: FakeRecipe[] = [];
let profile: Record<string, unknown> = {};
let idCounter = 0;
// Food-Katalog und strukturierte Zutaten (Standard: leer -> Textabgleich wie bei Altrezepten).
let foods: Record<string, unknown>[] = [];
let alternatives: Record<string, unknown>[] = [];
let recipeRows: { recipeId: string; position: number; foodId: string; displayName: string }[] = [];

vi.mock("./db", () => ({
  prisma: {
    profile: { findUniqueOrThrow: async () => profile },
    recipe: { findMany: async () => recipes },
    ingredient: { findMany: async () => foods },
    ingredientAlternative: { findMany: async () => alternatives },
    recipeIngredient: {
      findMany: async ({ where }: { where: { recipeId: { in: string[] } } }) =>
        recipeRows
          .filter((row) => where.recipeId.in.includes(row.recipeId))
          .map((row) => ({ id: `${row.recipeId}-${row.position}`, amount: 100, unit: "g", optional: false, note: null, gramsOverride: null, ...row })),
    },
    mealPlanDay: {
      findUnique: async ({ where }: { where: { profileId_date: { profileId: string; date: Date } } }) =>
        store.find((d) => d.profileId === where.profileId_date.profileId && d.date.getTime() === where.profileId_date.date.getTime()) ?? null,
      findMany: async ({ where }: { where: { profileId: string; date: { gte: Date; lte: Date } } }) =>
        store.filter((d) => d.profileId === where.profileId && d.date >= where.date.gte && d.date <= where.date.lte),
      create: async ({ data }: { data: Omit<StoredDay, "id" | "items"> & { items: { create: Omit<StoredItem, "id" | "recipe">[] } } }) => {
        createdDays.push(fromDbDate(data.date));
        const day: StoredDay = {
          id: `day-${++idCounter}`,
          profileId: data.profileId,
          date: data.date,
          targetKcal: data.targetKcal,
          targetProteinG: data.targetProteinG,
          targetCarbsG: data.targetCarbsG,
          targetFatG: data.targetFatG,
          items: data.items.create.map((item) => ({
            id: `item-${++idCounter}`,
            ...item,
            recipe: recipes.find((r) => r.id === item.recipeId)!,
          })),
        };
        store.push(day);
        return day;
      },
    },
  },
}));

const { getOrGenerateDayPlan, getOrGenerateWeekPlan } = await import("./generateMealPlan");

const PROFILE_ID = "profile-1";
const MONDAY: CalendarDate = "2026-09-14";
/**
 * Fester Kalendertag "heute" statt der echten Uhr: Die Tests planen die Woche ab ihrem Montag, alle
 * Tage darin sind bearbeitbar. Die Bearbeitungsgrenze selbst prüft der Block "Bearbeitungsgrenze (R5E)".
 */
const TODAY: CalendarDate = MONDAY;

/** Ein bearbeitbarer Tag (ab `today`) wird immer gelesen oder erzeugt, das Ergebnis ist nie null. */
async function editableDayPlan(day: CalendarDate, weekUsage?: RecipeUsage, today: CalendarDate = TODAY) {
  const plan = await getOrGenerateDayPlan(PROFILE_ID, day, today, weekUsage);
  if (!plan) throw new Error(`${day} ist ab ${today} bearbeitbar und muss einen Plan haben.`);
  return plan;
}

/** Eine Woche, deren Tage alle bearbeitbar sind (ab `TODAY`). */
async function editableWeekPlan(weekStart: CalendarDate) {
  const plans = await getOrGenerateWeekPlan(PROFILE_ID, weekStart, TODAY);
  return plans.map((plan, i) => {
    if (!plan) throw new Error(`Tag ${i} der Woche ab ${weekStart} ist bearbeitbar und muss einen Plan haben.`);
    return plan;
  });
}

function fakeRecipe(id: string, slot: string, overrides: Partial<FakeRecipe> = {}): FakeRecipe {
  // Makro-Zusammensetzung nahe an den Slot-Zielen (Protein ~25 %, Carbs ~45 %, Fett ~30 % der Kalorien).
  return {
    id,
    name: id,
    kcal: 500,
    proteinG: 31,
    carbsG: 56,
    fatG: 17,
    mealSlots: JSON.stringify([slot]),
    ingredients: JSON.stringify(["100 g Reis"]),
    instructions: "[]",
    dietTypes: JSON.stringify(["OMNIVORE"]),
    allergens: "[]",
    isTrending: false,
    isCustom: false,
    ownerProfileId: null,
    ...overrides,
  };
}

function recipesFor(slot: string, prefix: string, count: number): FakeRecipe[] {
  return Array.from({ length: count }, (_, i) => fakeRecipe(`${prefix}${i + 1}`, slot));
}

function baseProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    sex: "MALE",
    weightKg: 80,
    heightCm: 180,
    age: 30,
    activityLevel: "MODERATE",
    goal: "MAINTAIN",
    goalRateKgPerWeek: 0,
    sportType: "NONE",
    dietType: "OMNIVORE",
    allergies: [],
    likedFoods: [],
    dislikedFoods: [],
    trainingSessions: [],
    ...overrides,
  };
}

function slotRecipeIds(plans: Awaited<ReturnType<typeof editableWeekPlan>>, slot: string, time?: string) {
  return plans.map((p) => p.items.find((i) => i.slot === slot && (!time || i.time === time))?.recipeId);
}

beforeEach(() => {
  store = [];
  createdDays = [];
  idCounter = 0;
  foods = [];
  alternatives = [];
  recipeRows = [];
  profile = baseProfile();
  recipes = [
    ...recipesFor("BREAKFAST", "b", 7),
    ...recipesFor("SNACK", "s", 7),
    ...recipesFor("LUNCH", "l", 7),
    ...recipesFor("DINNER", "d", 7),
  ];
});

describe("getOrGenerateWeekPlan: Variety innerhalb der Woche", () => {
  it("wählt bei genug gleich passenden Rezepten an keinem Tag dasselbe Frühstück, Mittag- und Abendessen", async () => {
    const plans = await editableWeekPlan(MONDAY);

    expect(plans).toHaveLength(7);
    for (const [slot] of [["BREAKFAST"], ["LUNCH"], ["DINNER"]]) {
      const ids = slotRecipeIds(plans, slot);
      expect(new Set(ids).size).toBe(7);
    }
  });

  it("erzeugt fehlende Tage nacheinander, in Datumsreihenfolge", async () => {
    await editableWeekPlan(MONDAY);

    expect(createdDays).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("Gegenprobe: unabhängig erzeugte Tage (jeder mit leerer Verwendung) wiederholen dieselben Rezepte", async () => {
    const plans = [];
    for (let i = 0; i < 7; i++) plans.push(await editableDayPlan(addDays(MONDAY, i), new Map()));

    expect(new Set(slotRecipeIds(plans, "BREAKFAST")).size).toBe(1);
    expect(new Set(slotRecipeIds(plans, "LUNCH")).size).toBe(1);
  });

  it("erlaubt Wiederholung, wenn es pro Slot nur ein passendes Rezept gibt", async () => {
    recipes = [fakeRecipe("b1", "BREAKFAST"), fakeRecipe("s1", "SNACK"), fakeRecipe("l1", "LUNCH"), fakeRecipe("d1", "DINNER")];

    const plans = await editableWeekPlan(MONDAY);

    expect(slotRecipeIds(plans, "BREAKFAST")).toEqual(Array(7).fill("b1"));
    expect(slotRecipeIds(plans, "DINNER")).toEqual(Array(7).fill("d1"));
    for (const plan of plans) expect(plan.items.length).toBeGreaterThanOrEqual(4);
  });

  it("wiederholt bei zu kleinem Pool erst, wenn alle Rezepte einmal dran waren", async () => {
    recipes = [...recipesFor("BREAKFAST", "b", 3), fakeRecipe("s1", "SNACK"), fakeRecipe("l1", "LUNCH"), fakeRecipe("d1", "DINNER")];

    const plans = await editableWeekPlan(MONDAY);
    const breakfasts = slotRecipeIds(plans, "BREAKFAST");

    expect(breakfasts.slice(0, 3)).toEqual(["b1", "b2", "b3"]);
    expect(new Set(breakfasts)).toEqual(new Set(["b1", "b2", "b3"]));
  });

  it("lässt eine Lieblingszutat weiter gewinnen, wenn sie klar besser passt als die Alternative", async () => {
    profile = baseProfile({ likedFoods: [{ label: "Lachs" }] });
    recipes = [
      ...recipesFor("BREAKFAST", "b", 3),
      fakeRecipe("s1", "SNACK"),
      fakeRecipe("d1", "DINNER"),
      fakeRecipe("lachs-bowl", "LUNCH", { ingredients: JSON.stringify(["150 g Lachs"]) }),
      ...recipesFor("LUNCH", "l", 3),
    ];

    const plans = await editableWeekPlan(MONDAY);
    const lunches = slotRecipeIds(plans, "LUNCH");

    // +0.5 (liked) gegen höchstens -0.3 (dreimal benutzt): das Lieblingsgericht bleibt vorn.
    expect(lunches.filter((id) => id === "lachs-bowl").length).toBe(7);
  });

  it("verzichtet auf Abwechslung, wenn sie den Tag nährwertlich klar verschlechtern würde", async () => {
    // Gleiche Makro-Zusammensetzung (also gleicher Score), aber vierzigmal so groß: selbst mit der
    // kleinsten Portion (0.4x) würde das Mittagessen den Tag weit über die Ziele heben.
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l")),
      fakeRecipe("l-passend", "LUNCH"),
      fakeRecipe("l-riesig", "LUNCH", { kcal: 20000, proteinG: 1240, carbsG: 2240, fatG: 680 }),
    ];

    const plans = await editableWeekPlan(MONDAY);

    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-passend"));
    // Die übrigen Slots rotieren weiter, die Auswahl fällt nur für den betroffenen Tag zurück.
    expect(slotRecipeIds(plans, "BREAKFAST").filter(Boolean).length).toBe(7);
  });

  it("wechselt dagegen ab, wenn das zweite Rezept nährwertlich gleichwertig ist", async () => {
    recipes = [...recipes.filter((r) => !r.id.startsWith("l")), fakeRecipe("l-a", "LUNCH"), fakeRecipe("l-b", "LUNCH")];

    const plans = await editableWeekPlan(MONDAY);

    expect(slotRecipeIds(plans, "LUNCH").slice(0, 4)).toEqual(["l-a", "l-b", "l-a", "l-b"]);
  });

  it("hält Portionsgrenzen (0.4x bis 2.5x) und die Kalorienziele der Tage ein", async () => {
    const plans = await editableWeekPlan(MONDAY);

    for (const plan of plans) {
      const scales = plan.items.map((i) => i.portionMultiplier);
      for (const scale of scales) {
        expect(scale).toBeGreaterThanOrEqual(0.4 - 1e-9);
        expect(scale).toBeLessThanOrEqual(2.5 + 1e-9);
      }
    }
    // Gleiche Rezepte-Makros je Slot: die Tagessumme trifft das Ziel, egal welches der gleichwertigen Rezepte gewählt wurde.
    const totals = plans.map((p) => p.items.reduce((sum, i) => sum + i.recipe.kcal * i.portionMultiplier, 0));
    for (const total of totals) expect(Math.abs(total - totals[0])).toBeLessThan(1);
  });
});

describe("getOrGenerateWeekPlan: Trainingstage", () => {
  it("behält Pre-/Post-Workout-Slots an Trainingstagen und rotiert auch dort", async () => {
    // Mittwoch (weekday 2), Training 18:00 für 60 Minuten.
    profile = baseProfile({ trainingSessions: [{ weekday: 2, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" }] });
    recipes = [...recipes, ...recipesFor("PRE_WORKOUT", "pre", 3), ...recipesFor("POST_WORKOUT", "post", 3)];

    const plans = await editableWeekPlan(MONDAY);

    const wednesday = plans[2];
    expect(wednesday.items.map((i) => i.slot)).toEqual(["BREAKFAST", "SNACK", "LUNCH", "PRE_WORKOUT", "POST_WORKOUT"]);
    for (const [index, plan] of plans.entries()) {
      if (index === 2) continue;
      expect(plan.items.some((i) => i.slot === "PRE_WORKOUT" || i.slot === "POST_WORKOUT")).toBe(false);
      expect(plan.items).toHaveLength(5);
    }
  });

  it("wählt an mehreren Trainingstagen unterschiedliche Workout-Rezepte, solange es welche gibt", async () => {
    profile = baseProfile({
      trainingSessions: [0, 2, 4].map((weekday) => ({ weekday, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" })),
    });
    recipes = [...recipes, ...recipesFor("PRE_WORKOUT", "pre", 3), ...recipesFor("POST_WORKOUT", "post", 3)];

    const plans = await editableWeekPlan(MONDAY);
    const trainingDays = [plans[0], plans[2], plans[4]];

    expect(new Set(trainingDays.map((p) => p.items.find((i) => i.slot === "PRE_WORKOUT")!.recipeId)).size).toBe(3);
    expect(new Set(trainingDays.map((p) => p.items.find((i) => i.slot === "POST_WORKOUT")!.recipeId)).size).toBe(3);
  });

  it("wiederholt ein einziges Workout-Rezept, statt den Slot leer zu lassen", async () => {
    profile = baseProfile({
      trainingSessions: [0, 2].map((weekday) => ({ weekday, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" })),
    });
    recipes = [...recipes, fakeRecipe("pre1", "PRE_WORKOUT"), fakeRecipe("post1", "POST_WORKOUT")];

    const plans = await editableWeekPlan(MONDAY);

    expect(plans[0].items.find((i) => i.slot === "POST_WORKOUT")!.recipeId).toBe("post1");
    expect(plans[2].items.find((i) => i.slot === "POST_WORKOUT")!.recipeId).toBe("post1");
  });
});

describe("Wochenverwendung gehört zu genau einem Generierungslauf", () => {
  it("wirkt nicht auf den nächsten Lauf: eine neue Woche beginnt wieder beim ersten Rezept", async () => {
    const first = await editableWeekPlan(MONDAY);
    store = [];
    createdDays = [];
    const second = await editableWeekPlan(MONDAY);

    expect(slotRecipeIds(second, "BREAKFAST")).toEqual(slotRecipeIds(first, "BREAKFAST"));
    expect(slotRecipeIds(second, "BREAKFAST")[0]).toBe("b1");
  });

  it("ist zwischen Wochen unabhängig: die Folgewoche beginnt nicht bei den Rezepten der Vorwoche", async () => {
    await editableWeekPlan(MONDAY);
    const nextWeek = await editableWeekPlan("2026-09-21");

    expect(slotRecipeIds(nextWeek, "BREAKFAST")[0]).toBe("b1");
  });

  it("verwendet für einen Einzelaufruf ohne Übergabe eine frische Verwendung statt Zustand eines früheren Aufrufs", async () => {
    const monday = await editableDayPlan(MONDAY);
    store = [];
    const again = await editableDayPlan(MONDAY);

    expect(again.items.map((i) => i.recipeId)).toEqual(monday.items.map((i) => i.recipeId));
  });
});

describe("unlesbare Rezeptdaten (R5D)", () => {
  it("lässt ein Rezept mit kaputter JSON-Spalte mit Warnung aus dem Pool, statt die Planung scheitern zu lassen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    recipes = [
      fakeRecipe("kaputt-json", "BREAKFAST", { ingredients: "100 g Reis" }),
      fakeRecipe("kaputt-slot", "BREAKFAST", { mealSlots: JSON.stringify(["BRUNCH"]) }),
      ...recipes,
    ];

    const plans = await editableWeekPlan(MONDAY);

    const chosen = plans.flatMap((p) => p.items.map((i) => i.recipeId));
    expect(chosen).not.toContain("kaputt-json");
    expect(chosen).not.toContain("kaputt-slot");
    expect(new Set(slotRecipeIds(plans, "BREAKFAST")).size).toBe(7);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Recipe kaputt-json: Spalte "ingredients" enthält kein gültiges JSON'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Recipe kaputt-slot: Spalte "mealSlots" hat nicht die erwartete Form'));
    warn.mockRestore();
  });
});

describe("bereits gespeicherte Tage", () => {
  it("bleiben unverändert und werden nicht neu erzeugt", async () => {
    const stored = await editableDayPlan("2026-09-18", new Map());
    createdDays = [];

    const plans = await editableWeekPlan(MONDAY);

    expect(plans[4]).toBe(stored);
    expect(createdDays).toHaveLength(6);
    expect(createdDays).not.toContain("2026-09-18");
  });

  it("zählen für die Variety, auch wenn sie später in der Woche liegen als ein neu erzeugter Tag", async () => {
    await editableDayPlan("2026-09-18", new Map()); // Freitag: b1, l1, d1
    const plans = await editableWeekPlan(MONDAY);

    expect(slotRecipeIds(plans, "BREAKFAST")[0]).toBe("b2"); // Montag meidet das bereits am Freitag gewählte b1
    expect(new Set(slotRecipeIds(plans, "BREAKFAST")).size).toBe(7);
  });

  it("fließen auch in einen einzeln erzeugten Tag ein (Dashboard-Weg ohne Wochenaufruf)", async () => {
    const tuesday = await editableDayPlan("2026-09-15", new Map());
    const wednesday = await editableDayPlan("2026-09-16");

    const tuesdayBreakfast = tuesday.items.find((i) => i.slot === "BREAKFAST")!.recipeId;
    const wednesdayBreakfast = wednesday.items.find((i) => i.slot === "BREAKFAST")!.recipeId;
    expect(wednesdayBreakfast).not.toBe(tuesdayBreakfast);
  });

  it("zählen nicht aus einer anderen Woche", async () => {
    await editableDayPlan("2026-09-13", new Map(), "2026-09-13"); // Sonntag der Vorwoche, an diesem Tag erzeugt
    const monday = await editableDayPlan(MONDAY);

    expect(monday.items.find((i) => i.slot === "BREAKFAST")!.recipeId).toBe("b1");
  });
});

function foodRow(slug: string, name: string, aliases: string[] = [], allergens: string[] = []) {
  return {
    id: `food-${slug}`,
    name,
    normalizedName: name.toLowerCase(),
    slug,
    category: "misc",
    dietClass: "omnivore",
    aliases: JSON.stringify(aliases),
    allergens: JSON.stringify(allergens),
    negligible: false,
    unitGrams: null,
    kcalPer100: 100,
    proteinPer100G: 5,
    carbsPer100G: 10,
    fatPer100G: 2,
    fiberPer100G: 1,
    sugarPer100G: 1,
    saturatedFatPer100G: 0.5,
    sodiumPer100Mg: 10,
  };
}

describe("Allergien im persönlichen Plan (Regression: 'Erdnüsse' vs. Allergen 'erdnuss')", () => {
  const peanutLunch = () =>
    fakeRecipe("l-erdnuss", "LUNCH", {
      allergens: JSON.stringify(["erdnuss", "gluten"]),
      ingredients: JSON.stringify(["50 g Erdnussbutter"]),
    });

  beforeEach(() => {
    // Das Erdnuss-Rezept würde ohne Allergie klar gewinnen (Lieblingszutat, +0.5).
    recipes = [...recipesFor("BREAKFAST", "b", 7), ...recipesFor("SNACK", "s", 7), ...recipesFor("DINNER", "d", 7), peanutLunch(), fakeRecipe("l-sicher", "LUNCH")];
  });

  it("Kontrolle: ohne Allergie wird das Erdnuss-Rezept gewählt", async () => {
    profile = baseProfile({ likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await editableWeekPlan(MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toContain("l-erdnuss");
  });

  it("Allergie 'Erdnüsse' sperrt das Rezept mit Allergen 'erdnuss' an jedem Tag der Woche", async () => {
    profile = baseProfile({ allergies: [{ label: "Erdnüsse" }], likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await editableWeekPlan(MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-sicher"));
  });

  it.each(["Erdnuss", "erdnüsse", "Erdnuss-Allergie", "Nüsse"])("sperrt auch bei der Angabe '%s'", async (label) => {
    profile = baseProfile({ allergies: [{ label }], likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await editableDayPlan(MONDAY, new Map());
    expect(plans.items.some((i) => i.recipeId === "l-erdnuss")).toBe(false);
  });

  it("ein Rezept, das nicht zur Ernährungsform passt, wird nie geplant - auch als Lieblingsrezept (R5F-9)", async () => {
    const both = JSON.stringify(["OMNIVORE", "VEGAN"]);
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l-")).map((r) => ({ ...r, dietTypes: both })),
      fakeRecipe("l-omnivor", "LUNCH", { ingredients: JSON.stringify(["50 g Erdnussbutter"]) }),
      fakeRecipe("l-vegan", "LUNCH", { dietTypes: both }),
    ];
    profile = baseProfile({ dietType: "VEGAN", likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await editableWeekPlan(MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-vegan"));
  });

  it("lässt bei einer unbekannten Allergie ein Rezept mit dem Begriff in den Zutaten nicht durch", async () => {
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l-")),
      fakeRecipe("l-sellerie", "LUNCH", { ingredients: JSON.stringify(["100 g Sellerie"]) }),
      fakeRecipe("l-sicher", "LUNCH"),
    ];
    profile = baseProfile({ allergies: [{ label: "Sellerie" }], likedFoods: [{ label: "Sellerie" }] });
    const plans = await editableWeekPlan(MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-sicher"));
  });
});

describe("Lieblinge und Abneigungen über die gemeinsame Food-Auflösung", () => {
  it("Abneigung 'Reis' sperrt das Reisrezept, nicht die Reiswaffeln; das Altrezept bleibt beim Textabgleich", async () => {
    foods = [foodRow("reis", "Reis", ["basmatireis"]), foodRow("reiswaffeln", "Reiswaffeln", ["reiswaffel"])];
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l")),
      fakeRecipe("l-reis", "LUNCH", { ingredients: JSON.stringify(["75 g Reis"]) }),
      fakeRecipe("l-waffeln", "LUNCH", { ingredients: JSON.stringify(["3 Reiswaffeln"]) }),
      fakeRecipe("l-altrezept", "LUNCH", { ingredients: JSON.stringify(["100 g Basmatireis"]) }), // ohne strukturierte Zutaten
    ];
    // Die übrigen Slots haben Rezepte mit "Reis" im Text: hier interessiert nur das Mittagessen.
    recipeRows = [
      { recipeId: "l-reis", position: 0, foodId: "food-reis", displayName: "Reis" },
      { recipeId: "l-waffeln", position: 0, foodId: "food-reiswaffeln", displayName: "Reiswaffeln" },
    ];
    profile = baseProfile({ dislikedFoods: [{ label: "Reis" }] });

    const plans = await editableWeekPlan(MONDAY);

    expect(new Set(slotRecipeIds(plans, "LUNCH"))).toEqual(new Set(["l-waffeln"]));
  });

  it("Lieblingsfood 'Hähnchen' trifft über den Alias auch ein strukturiertes Rezept mit 'Poulet' im Text", async () => {
    foods = [foodRow("haehnchenbrust", "Hähnchenbrust", ["hähnchen", "poulet"])];
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l")),
      fakeRecipe("l-poulet", "LUNCH", { ingredients: JSON.stringify(["150 g Poulet"]) }),
      fakeRecipe("l-kichererbsen", "LUNCH", { ingredients: JSON.stringify(["150 g Kichererbsen"]) }),
    ];
    recipeRows = [{ recipeId: "l-poulet", position: 0, foodId: "food-haehnchenbrust", displayName: "Poulet" }];
    profile = baseProfile({ likedFoods: [{ label: "Hähnchen" }] });

    const plans = await editableWeekPlan(MONDAY);

    // +0.5 (Lieblingsfood) bleibt vor dem Wiederholungsabschlag von höchstens 0.3.
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-poulet"));
  });

  it("ein unbekanntes Label erzeugt keinen Treffer aus dem Nichts", async () => {
    foods = [foodRow("reis", "Reis")];
    recipes = [...recipes.filter((r) => !r.id.startsWith("l")), fakeRecipe("l-a", "LUNCH"), fakeRecipe("l-b", "LUNCH", { ingredients: JSON.stringify(["100 g Kichererbsen"]) })];
    profile = baseProfile({ likedFoods: [{ label: "Trüffel" }] });

    const plans = await editableWeekPlan(MONDAY);

    // Beide Rezepte sind gleich bewertet: sie wechseln sich ab, keines wird wegen "Trüffel" bevorzugt.
    expect(slotRecipeIds(plans, "LUNCH").slice(0, 4)).toEqual(["l-a", "l-b", "l-a", "l-b"]);
  });
});

describe("Bearbeitungsgrenze (R5E): gestern und früher historisch, heute und Zukunft bearbeitbar", () => {
  // Die In-Memory-Nachbildung kennt kein update/delete: jeder Versuch, einen Tag zu überschreiben, würde werfen.
  const THURSDAY: CalendarDate = "2026-09-17";

  it("gibt einen gespeicherten vergangenen Tag unverändert zurück, auch wenn heute andere Rezepte gewählt würden", async () => {
    const stored = await getOrGenerateDayPlan(PROFILE_ID, "2026-09-16", "2026-09-16"); // am Mittwoch selbst erzeugt
    const storedRecipeIds = stored!.items.map((i) => i.recipeId);
    createdDays = [];
    recipes = [...recipesFor("BREAKFAST", "neu-b", 3), ...recipesFor("LUNCH", "neu-l", 3), ...recipesFor("DINNER", "neu-d", 3)];

    const later = await getOrGenerateDayPlan(PROFILE_ID, "2026-09-16", THURSDAY);

    expect(later).toBe(stored);
    expect(later!.items.map((i) => i.recipeId)).toEqual(storedRecipeIds);
    expect(createdDays).toEqual([]);
    expect(store).toHaveLength(1);
  });

  it.each([
    ["gestern", "2026-09-16"],
    ["weit in der Vergangenheit", "2020-01-01"],
  ] as const)("erzeugt einen fehlenden vergangenen Tag (%s) nicht nachträglich", async (_label, day) => {
    expect(await getOrGenerateDayPlan(PROFILE_ID, day, THURSDAY)).toBeNull();
    expect(createdDays).toEqual([]);
    expect(store).toEqual([]);
  });

  it("erzeugt heute weiterhin", async () => {
    const plan = await getOrGenerateDayPlan(PROFILE_ID, THURSDAY, THURSDAY);

    expect(plan?.items.length).toBeGreaterThan(0);
    expect(createdDays).toEqual([THURSDAY]);
  });

  it("erzeugt einen künftigen Tag weiterhin", async () => {
    const plan = await getOrGenerateDayPlan(PROFILE_ID, "2026-09-18", THURSDAY);

    expect(plan?.items.length).toBeGreaterThan(0);
    expect(createdDays).toEqual(["2026-09-18"]);
  });

  it("die Woche erzeugt nur heute und die Zukunft; fehlende vergangene Tage bleiben null", async () => {
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY, THURSDAY);

    expect(plans.slice(0, 3)).toEqual([null, null, null]);
    expect(plans.slice(3).every((plan) => plan !== null && plan.items.length > 0)).toBe(true);
    expect(createdDays).toEqual(["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("die Woche liefert einen gespeicherten vergangenen Tag unverändert mit, ohne die Lücken daneben zu füllen", async () => {
    const tuesday = await getOrGenerateDayPlan(PROFILE_ID, "2026-09-15", "2026-09-15");
    createdDays = [];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY, THURSDAY);

    expect(plans[0]).toBeNull();
    expect(plans[1]).toBe(tuesday);
    expect(plans[2]).toBeNull();
    expect(createdDays).toEqual(["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]);
  });

  it("zählt einen gespeicherten vergangenen Tag weiter für die Abwechslung der neu erzeugten Tage", async () => {
    const tuesday = await getOrGenerateDayPlan(PROFILE_ID, "2026-09-15", "2026-09-15");
    const tuesdayBreakfast = tuesday!.items.find((i) => i.slot === "BREAKFAST")!.recipeId;

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY, THURSDAY);

    expect(plans[3]!.items.find((i) => i.slot === "BREAKFAST")!.recipeId).not.toBe(tuesdayBreakfast);
  });
});

describe("Rezept-Snapshot (R5E)", () => {
  it("speichert je Mahlzeit Name und Nährwerte je Portion des gewählten Rezepts, unskaliert neben dem Portionsfaktor", async () => {
    recipes = [
      fakeRecipe("frühstück", "BREAKFAST", { name: "Porridge", kcal: 420, proteinG: 22.5, carbsG: 60, fatG: 9.5 }),
      fakeRecipe("mittag", "LUNCH", { name: "Linsen-Curry", kcal: 610, proteinG: 28, carbsG: 70, fatG: 19 }),
      fakeRecipe("abend", "DINNER", { name: "Lachs mit Reis", kcal: 680, proteinG: 41, carbsG: 62, fatG: 24 }),
    ];

    await editableDayPlan(MONDAY);

    const storedItems = store[0].items;
    expect(storedItems.length).toBeGreaterThan(0);
    for (const stored of storedItems) {
      const recipe = recipes.find((r) => r.id === stored.recipeId)!;
      expect(stored).toMatchObject({
        recipeName: recipe.name,
        recipeKcal: recipe.kcal,
        recipeProteinG: recipe.proteinG,
        recipeCarbsG: recipe.carbsG,
        recipeFatG: recipe.fatG,
      });
      // Die Menge steht allein im Portionsfaktor; der Snapshot bleibt der Basiswert je Portion.
      expect(stored.portionMultiplier).toBeGreaterThan(0);
    }
  });
});

describe("Charakterisierung: Planergebnisse bleiben durch R5F-11 unverändert", () => {
  const INGREDIENTS = ["200 g Hähnchen", "100 g Reis", "150 g Pilze", "50 g Erdnüsse", "200 g Tofu"];
  const SLOTS = ["BREAKFAST", "SNACK", "LUNCH", "DINNER", "PRE_WORKOUT", "POST_WORKOUT"];

  /** Rezepte mit unterschiedlichen Makros und Zutaten je Slot - damit Auswahl, Variety und Skalierung wirklich arbeiten. */
  function variedRecipes(): FakeRecipe[] {
    return SLOTS.flatMap((slot, s) =>
      Array.from({ length: 5 }, (_, i) =>
        fakeRecipe(`${slot.toLowerCase()}-${i}`, slot, {
          kcal: 300 + ((i + s) % 5) * 70,
          proteinG: 15 + ((i * 3 + s) % 5) * 6,
          carbsG: 40 + ((i + 2 * s) % 3) * 12,
          fatG: 8 + ((i + s) % 4) * 4,
          ingredients: JSON.stringify([INGREDIENTS[(i + s) % INGREDIENTS.length], "1 Prise Salz"]),
        }),
      ),
    );
  }

  /** Mit dem Stand vor R5F-11 erzeugt (Pläne je Tag: Datum, Tagesziele, Mahlzeiten mit Slot, Uhrzeit, Rezept, Portion). */
  const EXPECTED = {
    wednesday: {"date": "2026-09-16", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
    week1: [
      {"date": "2026-09-14", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.610463302828128], ["SNACK", "10:30", "snack-4", 1.6720756488186987], ["LUNCH", "13:00", "lunch-3", 1.4753175347013257], ["PRE_WORKOUT", "15:30", "pre_workout-1", 1.1572416793324711], ["POST_WORKOUT", "19:30", "post_workout-0", 0.4]]},
      {"date": "2026-09-15", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-16", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-17", "targets": [2209, 160, 226, 74], "items": [["PRE_WORKOUT", "04:30", "pre_workout-1", 0.7875737602763973], ["POST_WORKOUT", "08:15", "post_workout-0", 0.4], ["SNACK", "10:30", "snack-4", 1.0549688290591972], ["LUNCH", "13:00", "lunch-3", 1.0201980436810874], ["SNACK", "16:00", "snack-0", 0.4], ["DINNER", "19:30", "dinner-3", 2.083772417094376]]},
      {"date": "2026-09-18", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-19", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.7175553486614201], ["PRE_WORKOUT", "09:30", "pre_workout-1", 1.2613360975925167], ["POST_WORKOUT", "14:00", "post_workout-4", 0.5332844374442827], ["SNACK", "16:00", "snack-4", 1.452502290124607], ["DINNER", "19:30", "dinner-2", 0.94004626728614]]},
      {"date": "2026-09-20", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
    ],
    week2: [
      {"date": "2026-09-21", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.610463302828128], ["SNACK", "10:30", "snack-4", 1.6720756488186987], ["LUNCH", "13:00", "lunch-3", 1.4753175347013257], ["PRE_WORKOUT", "15:30", "pre_workout-1", 1.1572416793324711], ["POST_WORKOUT", "19:30", "post_workout-0", 0.4]]},
      {"date": "2026-09-22", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-23", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-24", "targets": [2209, 160, 226, 74], "items": [["PRE_WORKOUT", "04:30", "pre_workout-1", 0.7875737602763973], ["POST_WORKOUT", "08:15", "post_workout-0", 0.4], ["SNACK", "10:30", "snack-4", 1.0549688290591972], ["LUNCH", "13:00", "lunch-3", 1.0201980436810874], ["SNACK", "16:00", "snack-0", 0.4], ["DINNER", "19:30", "dinner-3", 2.083772417094376]]},
      {"date": "2026-09-25", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
      {"date": "2026-09-26", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.7175553486614201], ["PRE_WORKOUT", "09:30", "pre_workout-1", 1.2613360975925167], ["POST_WORKOUT", "14:00", "post_workout-4", 0.5332844374442827], ["SNACK", "16:00", "snack-4", 1.452502290124607], ["DINNER", "19:30", "dinner-2", 0.94004626728614]]},
      {"date": "2026-09-27", "targets": [2209, 160, 226, 74], "items": [["BREAKFAST", "08:00", "breakfast-0", 1.0309978917198999], ["SNACK", "10:30", "snack-4", 1.2566094568380597], ["LUNCH", "13:00", "lunch-3", 1.002268863192137], ["SNACK", "16:00", "snack-3", 0.4], ["DINNER", "19:30", "dinner-3", 2.225276977586019]]},
    ],
  };

  type PlanLike = Awaited<ReturnType<typeof editableDayPlan>> | null;
  function summary(plan: PlanLike) {
    if (!plan) return null;
    return {
      date: fromDbDate(plan.date),
      targets: [plan.targetKcal, plan.targetProteinG, plan.targetCarbsG, plan.targetFatG],
      items: plan.items.map((item) => [item.slot, item.time, item.recipeId, item.portionMultiplier]),
    };
  }

  it("liefert für Training, Vorlieben, Abneigungen, Allergie und zwei Wochen (Einzeltag und Woche) dieselben Pläne", async () => {
    recipes = variedRecipes();
    profile = baseProfile({
      sportType: "STRENGTH",
      goal: "LOSE_WEIGHT",
      goalRateKgPerWeek: 0.5,
      likedFoods: [{ label: "Hähnchen" }],
      dislikedFoods: [{ label: "Pilze" }],
      allergies: [{ label: "Erdnüsse" }],
      trainingSessions: [
        { weekday: 0, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" },
        { weekday: 3, startTime: "07:00", durationMin: 45, sportType: "ENDURANCE" },
        { weekday: 5, startTime: "12:00", durationMin: 90, sportType: "MIXED" },
      ],
    });

    // Dashboard-Weg: ein einzelner Tag zuerst, danach die Woche (zählt ihn für die Abwechslung mit).
    const wednesday = await editableDayPlan(addDays(MONDAY, 2));
    const week1 = await editableWeekPlan(MONDAY);
    const week2 = await editableWeekPlan(addDays(MONDAY, 7));

    expect({ wednesday: summary(wednesday), week1: week1.map(summary), week2: week2.map(summary) }).toEqual(EXPECTED);
  });
});
