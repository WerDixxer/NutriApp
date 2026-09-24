import { beforeEach, describe, expect, it, vi } from "vitest";

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
let createdDates: number[] = [];
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
      create: async ({ data }: { data: { profileId: string; date: Date; items: { create: Omit<StoredItem, "id" | "recipe">[] } } }) => {
        createdDates.push(data.date.getTime());
        const day: StoredDay = {
          id: `day-${++idCounter}`,
          profileId: data.profileId,
          date: data.date,
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
const MONDAY = new Date(2026, 8, 14);

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

function slotRecipeIds(plans: Awaited<ReturnType<typeof getOrGenerateWeekPlan>>, slot: string, time?: string) {
  return plans.map((p) => p.items.find((i) => i.slot === slot && (!time || i.time === time))?.recipeId);
}

beforeEach(() => {
  store = [];
  createdDates = [];
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
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(plans).toHaveLength(7);
    for (const [slot] of [["BREAKFAST"], ["LUNCH"], ["DINNER"]]) {
      const ids = slotRecipeIds(plans, slot);
      expect(new Set(ids).size).toBe(7);
    }
  });

  it("erzeugt fehlende Tage nacheinander, in Datumsreihenfolge", async () => {
    await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    const expected = Array.from({ length: 7 }, (_, i) => new Date(2026, 8, 14 + i).getTime());
    expect(createdDates).toEqual(expected);
  });

  it("Gegenprobe: unabhängig erzeugte Tage (jeder mit leerer Verwendung) wiederholen dieselben Rezepte", async () => {
    const plans = [];
    for (let i = 0; i < 7; i++) plans.push(await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 14 + i), new Map()));

    expect(new Set(slotRecipeIds(plans, "BREAKFAST")).size).toBe(1);
    expect(new Set(slotRecipeIds(plans, "LUNCH")).size).toBe(1);
  });

  it("erlaubt Wiederholung, wenn es pro Slot nur ein passendes Rezept gibt", async () => {
    recipes = [fakeRecipe("b1", "BREAKFAST"), fakeRecipe("s1", "SNACK"), fakeRecipe("l1", "LUNCH"), fakeRecipe("d1", "DINNER")];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(slotRecipeIds(plans, "BREAKFAST")).toEqual(Array(7).fill("b1"));
    expect(slotRecipeIds(plans, "DINNER")).toEqual(Array(7).fill("d1"));
    for (const plan of plans) expect(plan.items.length).toBeGreaterThanOrEqual(4);
  });

  it("wiederholt bei zu kleinem Pool erst, wenn alle Rezepte einmal dran waren", async () => {
    recipes = [...recipesFor("BREAKFAST", "b", 3), fakeRecipe("s1", "SNACK"), fakeRecipe("l1", "LUNCH"), fakeRecipe("d1", "DINNER")];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-passend"));
    // Die übrigen Slots rotieren weiter, die Auswahl fällt nur für den betroffenen Tag zurück.
    expect(slotRecipeIds(plans, "BREAKFAST").filter(Boolean).length).toBe(7);
  });

  it("wechselt dagegen ab, wenn das zweite Rezept nährwertlich gleichwertig ist", async () => {
    recipes = [...recipes.filter((r) => !r.id.startsWith("l")), fakeRecipe("l-a", "LUNCH"), fakeRecipe("l-b", "LUNCH")];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(slotRecipeIds(plans, "LUNCH").slice(0, 4)).toEqual(["l-a", "l-b", "l-a", "l-b"]);
  });

  it("hält Portionsgrenzen (0.4x bis 2.5x) und die Kalorienziele der Tage ein", async () => {
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
    const trainingDays = [plans[0], plans[2], plans[4]];

    expect(new Set(trainingDays.map((p) => p.items.find((i) => i.slot === "PRE_WORKOUT")!.recipeId)).size).toBe(3);
    expect(new Set(trainingDays.map((p) => p.items.find((i) => i.slot === "POST_WORKOUT")!.recipeId)).size).toBe(3);
  });

  it("wiederholt ein einziges Workout-Rezept, statt den Slot leer zu lassen", async () => {
    profile = baseProfile({
      trainingSessions: [0, 2].map((weekday) => ({ weekday, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" })),
    });
    recipes = [...recipes, fakeRecipe("pre1", "PRE_WORKOUT"), fakeRecipe("post1", "POST_WORKOUT")];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(plans[0].items.find((i) => i.slot === "POST_WORKOUT")!.recipeId).toBe("post1");
    expect(plans[2].items.find((i) => i.slot === "POST_WORKOUT")!.recipeId).toBe("post1");
  });
});

describe("Wochenverwendung gehört zu genau einem Generierungslauf", () => {
  it("wirkt nicht auf den nächsten Lauf: eine neue Woche beginnt wieder beim ersten Rezept", async () => {
    const first = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
    store = [];
    createdDates = [];
    const second = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(slotRecipeIds(second, "BREAKFAST")).toEqual(slotRecipeIds(first, "BREAKFAST"));
    expect(slotRecipeIds(second, "BREAKFAST")[0]).toBe("b1");
  });

  it("ist zwischen Wochen unabhängig: die Folgewoche beginnt nicht bei den Rezepten der Vorwoche", async () => {
    await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
    const nextWeek = await getOrGenerateWeekPlan(PROFILE_ID, new Date(2026, 8, 21));

    expect(slotRecipeIds(nextWeek, "BREAKFAST")[0]).toBe("b1");
  });

  it("verwendet für einen Einzelaufruf ohne Übergabe eine frische Verwendung statt Zustand eines früheren Aufrufs", async () => {
    const monday = await getOrGenerateDayPlan(PROFILE_ID, MONDAY);
    store = [];
    const again = await getOrGenerateDayPlan(PROFILE_ID, MONDAY);

    expect(again.items.map((i) => i.recipeId)).toEqual(monday.items.map((i) => i.recipeId));
  });
});

describe("bereits gespeicherte Tage", () => {
  it("bleiben unverändert und werden nicht neu erzeugt", async () => {
    const stored = await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 18), new Map());
    createdDates = [];

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(plans[4]).toBe(stored);
    expect(createdDates).toHaveLength(6);
    expect(createdDates).not.toContain(new Date(2026, 8, 18).getTime());
  });

  it("zählen für die Variety, auch wenn sie später in der Woche liegen als ein neu erzeugter Tag", async () => {
    await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 18), new Map()); // Freitag: b1, l1, d1
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    expect(slotRecipeIds(plans, "BREAKFAST")[0]).toBe("b2"); // Montag meidet das bereits am Freitag gewählte b1
    expect(new Set(slotRecipeIds(plans, "BREAKFAST")).size).toBe(7);
  });

  it("fließen auch in einen einzeln erzeugten Tag ein (Dashboard-Weg ohne Wochenaufruf)", async () => {
    const tuesday = await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 15), new Map());
    const wednesday = await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 16));

    const tuesdayBreakfast = tuesday.items.find((i) => i.slot === "BREAKFAST")!.recipeId;
    const wednesdayBreakfast = wednesday.items.find((i) => i.slot === "BREAKFAST")!.recipeId;
    expect(wednesdayBreakfast).not.toBe(tuesdayBreakfast);
  });

  it("zählen nicht aus einer anderen Woche", async () => {
    await getOrGenerateDayPlan(PROFILE_ID, new Date(2026, 8, 13), new Map()); // Sonntag der Vorwoche
    const monday = await getOrGenerateDayPlan(PROFILE_ID, MONDAY);

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
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toContain("l-erdnuss");
  });

  it("Allergie 'Erdnüsse' sperrt das Rezept mit Allergen 'erdnuss' an jedem Tag der Woche", async () => {
    profile = baseProfile({ allergies: [{ label: "Erdnüsse" }], likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-sicher"));
  });

  it.each(["Erdnuss", "erdnüsse", "Erdnuss-Allergie", "Nüsse"])("sperrt auch bei der Angabe '%s'", async (label) => {
    profile = baseProfile({ allergies: [{ label }], likedFoods: [{ label: "Erdnussbutter" }] });
    const plans = await getOrGenerateDayPlan(PROFILE_ID, MONDAY, new Map());
    expect(plans.items.some((i) => i.recipeId === "l-erdnuss")).toBe(false);
  });

  it("lässt bei einer unbekannten Allergie ein Rezept mit dem Begriff in den Zutaten nicht durch", async () => {
    recipes = [
      ...recipes.filter((r) => !r.id.startsWith("l-")),
      fakeRecipe("l-sellerie", "LUNCH", { ingredients: JSON.stringify(["100 g Sellerie"]) }),
      fakeRecipe("l-sicher", "LUNCH"),
    ];
    profile = baseProfile({ allergies: [{ label: "Sellerie" }], likedFoods: [{ label: "Sellerie" }] });
    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);
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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

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

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    // +0.5 (Lieblingsfood) bleibt vor dem Wiederholungsabschlag von höchstens 0.3.
    expect(slotRecipeIds(plans, "LUNCH")).toEqual(Array(7).fill("l-poulet"));
  });

  it("ein unbekanntes Label erzeugt keinen Treffer aus dem Nichts", async () => {
    foods = [foodRow("reis", "Reis")];
    recipes = [...recipes.filter((r) => !r.id.startsWith("l")), fakeRecipe("l-a", "LUNCH"), fakeRecipe("l-b", "LUNCH", { ingredients: JSON.stringify(["100 g Kichererbsen"]) })];
    profile = baseProfile({ likedFoods: [{ label: "Trüffel" }] });

    const plans = await getOrGenerateWeekPlan(PROFILE_ID, MONDAY);

    // Beide Rezepte sind gleich bewertet: sie wechseln sich ab, keines wird wegen "Trüffel" bevorzugt.
    expect(slotRecipeIds(plans, "LUNCH").slice(0, 4)).toEqual(["l-a", "l-b", "l-a", "l-b"]);
  });
});