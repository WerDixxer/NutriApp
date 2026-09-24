import { describe, expect, it } from "vitest";
import {
  REPETITION_PENALTY_MAX_USES,
  REPETITION_PENALTY_PER_USE,
  buildDayPlan,
  dayMacroDeviation,
  repetitionPenalty,
  selectRecipeForSlot,
  type RecipeCandidate,
  type SlotTarget,
} from "./planner";

// Makro-Anteile an den Kalorien: Protein ~0.23, Carbs ~0.46, Fett ~0.26.
const target: SlotTarget = { slot: "LUNCH", time: "13:00", kcal: 700, proteinG: 40, carbsG: 80, fatG: 20 };

function recipe(id: string, overrides: Partial<RecipeCandidate> = {}): RecipeCandidate {
  return {
    id,
    name: `Rezept ${id}`,
    kcal: 700,
    proteinG: 40,
    carbsG: 80,
    fatG: 20,
    mealSlots: ["LUNCH"],
    ingredients: ["100 g Reis"],
    isTrending: false,
    ...overrides,
  };
}

/** Wählt der Reihe nach für mehrere Tage und trägt die Wahl in die Wochenverwendung ein, wie generateMealPlan.ts. */
function pickDays(candidates: RecipeCandidate[], days: number, usage: Map<string, number> | undefined, liked: string[] = []) {
  const picks: string[] = [];
  for (let i = 0; i < days; i++) {
    const chosen = selectRecipeForSlot(candidates, target, liked, [], new Set(), usage);
    picks.push(chosen!.id);
    if (usage) usage.set(chosen!.id, (usage.get(chosen!.id) ?? 0) + 1);
  }
  return picks;
}

describe("selectRecipeForSlot: bisheriges Verhalten", () => {
  it("wählt das Rezept mit der besten Makro-Zusammensetzung", () => {
    const good = recipe("gut");
    const off = recipe("schief", { kcal: 700, proteinG: 10, carbsG: 130, fatG: 10 });
    expect(selectRecipeForSlot([off, good], target, [], [], new Set())?.id).toBe("gut");
  });

  it("schließt Rezepte mit abgelehnten Zutaten aus, auch wenn sie perfekt passen", () => {
    const disliked = recipe("mit-pilzen", { ingredients: ["200 g Champignons"] });
    const other = recipe("ohne", { kcal: 700, proteinG: 25, carbsG: 100, fatG: 20 });
    expect(selectRecipeForSlot([disliked, other], target, [], ["Champignons"], new Set())?.id).toBe("ohne");
    expect(selectRecipeForSlot([disliked], target, [], ["Champignons"], new Set())).toBeNull();
  });

  it("bevorzugt Lieblingszutaten vor einer leicht besseren Makro-Passung", () => {
    const liked = recipe("mit-reis", { proteinG: 30, carbsG: 95, ingredients: ["150 g Reis"] });
    const better = recipe("besser", { ingredients: ["150 g Kartoffeln"] });
    expect(selectRecipeForSlot([better, liked], target, ["Reis"], [], new Set())?.id).toBe("mit-reis");
  });

  it("ignoriert Rezepte, die nicht für den Slot vorgesehen sind", () => {
    const dinnerOnly = recipe("abend", { mealSlots: ["DINNER"] });
    expect(selectRecipeForSlot([dinnerOnly], target, [], [], new Set())).toBeNull();
  });

  it("überspringt Rezepte des Tages und fällt zurück, wenn alle schon benutzt sind", () => {
    const a = recipe("a");
    const b = recipe("b", { proteinG: 30, carbsG: 90 });
    expect(selectRecipeForSlot([a, b], target, [], [], new Set(["a"]))?.id).toBe("b");
    expect(selectRecipeForSlot([a, b], target, [], [], new Set(["a", "b"]))?.id).toBe("a");
  });
});

describe("selectRecipeForSlot: gemeinsame Präferenz-Auflösung (preferenceHit)", () => {
  it("eine aufgelöste Abneigung schließt das Rezept aus, auch wenn der Text das Label nicht enthält", () => {
    const flagged = recipe("aufgeloest", { ingredients: ["150 g Poulet"], preferenceHit: { liked: false, disliked: true } });
    const other = recipe("anderes", { proteinG: 25, carbsG: 100 });
    expect(selectRecipeForSlot([flagged, other], target, [], ["Hähnchen"], new Set())?.id).toBe("anderes");
  });

  it("ein Text-Treffer allein zählt nicht, wenn die Auflösung ihn verneint (Reis in Reiswaffeln)", () => {
    const waffeln = recipe("waffeln", { ingredients: ["3 Reiswaffeln"], preferenceHit: { liked: false, disliked: false } });
    expect(selectRecipeForSlot([waffeln], target, [], ["Reis"], new Set())?.id).toBe("waffeln");
    const lieblingOhneTreffer = recipe("l", { ingredients: ["3 Reiswaffeln"], preferenceHit: { liked: false, disliked: false } });
    const echtesLieblingsrezept = recipe("reis", { proteinG: 32, carbsG: 78, ingredients: ["75 g Reis"], preferenceHit: { liked: true, disliked: false } });
    expect(selectRecipeForSlot([lieblingOhneTreffer, echtesLieblingsrezept], target, ["Reis"], [], new Set())?.id).toBe("reis");
  });

  it("der Lieblingsbonus greift für einen aufgelösten Treffer", () => {
    const liked = recipe("liked", { proteinG: 30, carbsG: 95, ingredients: ["150 g Poulet"], preferenceHit: { liked: true, disliked: false } });
    const better = recipe("besser", { ingredients: ["150 g Kartoffeln"] });
    expect(selectRecipeForSlot([better, liked], target, ["Hähnchen"], [], new Set())?.id).toBe("liked");
  });

  it("ohne preferenceHit gilt weiter der Textabgleich", () => {
    const text = recipe("text", { proteinG: 30, carbsG: 95, ingredients: ["150 g Reis"] });
    const better = recipe("besser", { ingredients: ["150 g Kartoffeln"] });
    expect(selectRecipeForSlot([better, text], target, ["Reis"], [], new Set())?.id).toBe("text");
  });
});

describe("repetitionPenalty", () => {
  it("wächst mit jeder Verwendung und ist gedeckelt", () => {
    expect(repetitionPenalty(0)).toBe(0);
    expect(repetitionPenalty(1)).toBeCloseTo(REPETITION_PENALTY_PER_USE);
    expect(repetitionPenalty(2)).toBeCloseTo(2 * REPETITION_PENALTY_PER_USE);
    expect(repetitionPenalty(3)).toBeCloseTo(3 * REPETITION_PENALTY_PER_USE);
    expect(repetitionPenalty(10)).toBeCloseTo(REPETITION_PENALTY_MAX_USES * REPETITION_PENALTY_PER_USE);
    expect(repetitionPenalty(-2)).toBe(0);
  });

  it("bleibt unter dem Lieblingsbonus von 0.5, sonst könnte Variety Präferenzen überstimmen", () => {
    expect(repetitionPenalty(Number.MAX_SAFE_INTEGER)).toBeLessThan(0.5);
  });
});

describe("selectRecipeForSlot: Wochen-Variety", () => {
  it("A: rotiert zwischen gleich passenden Rezepten statt siebenmal dasselbe zu wählen", () => {
    const candidates = [recipe("a"), recipe("b"), recipe("c")];

    expect(pickDays(candidates, 3, new Map())).toEqual(["a", "b", "c"]);
    expect(pickDays(candidates, 6, new Map())).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("A (Gegenprobe): ohne Wochenverwendung wählt jeder Tag unabhängig dasselbe Rezept", () => {
    expect(pickDays([recipe("a"), recipe("b"), recipe("c")], 3, undefined)).toEqual(["a", "a", "a"]);
  });

  it("B: mit nur einem passenden Rezept bleibt Wiederholung möglich", () => {
    expect(pickDays([recipe("a")], 3, new Map())).toEqual(["a", "a", "a"]);
  });

  it("B: auch ein weit schlechter passendes Rezept verdrängt das einzige gute nicht", () => {
    const good = recipe("gut");
    const poor = recipe("schlecht", { proteinG: 5, carbsG: 130, fatG: 0 });
    expect(pickDays([good, poor], 4, new Map())).toEqual(["gut", "gut", "gut", "gut"]);
  });

  it("C: ein Lieblingsrezept setzt sich auch nach mehrfacher Verwendung gegen ein gleich passendes durch", () => {
    const liked = recipe("lieblings-reis", { ingredients: ["150 g Reis"] });
    const plain = recipe("neutral", { ingredients: ["150 g Kartoffeln"] });
    const usage = new Map([["lieblings-reis", 3]]);
    expect(selectRecipeForSlot([plain, liked], target, ["Reis"], [], new Set(), usage)?.id).toBe("lieblings-reis");
  });

  it("C: ein Lieblingsrezept wird dennoch abgewechselt, wenn es gleich gut passt wie ein zweites Lieblingsrezept", () => {
    const one = recipe("reis-a", { ingredients: ["150 g Reis"] });
    const two = recipe("reis-b", { ingredients: ["150 g Reis"] });
    expect(pickDays([one, two], 4, new Map(), ["Reis"])).toEqual(["reis-a", "reis-b", "reis-a", "reis-b"]);
  });

  it("D: ein nährwertlich klar passendes Rezept bleibt vor einem unpassenden, auch nach maximaler Wiederholung", () => {
    const fits = recipe("passt");
    const unsuitable = recipe("unpassend", { kcal: 700, proteinG: 5, carbsG: 130, fatG: 0 });
    const usage = new Map([["passt", 99]]);
    expect(selectRecipeForSlot([unsuitable, fits], target, [], [], new Set(), usage)?.id).toBe("passt");
  });

  it("D: ein nur wenig schlechter passendes, noch unbenutztes Rezept darf dagegen übernehmen", () => {
    const best = recipe("beste");
    const nearly = recipe("fast-gleich", { proteinG: 38, carbsG: 82 });
    const usage = new Map([["beste", 1]]);
    expect(selectRecipeForSlot([best, nearly], target, [], [], new Set(), usage)?.id).toBe("fast-gleich");
  });

  it("D: Ausschlüsse bleiben Ausschlüsse: abgelehnte und slot-fremde Rezepte gewinnen nie, nur weil sie unbenutzt sind", () => {
    const used = recipe("benutzt");
    const disliked = recipe("mit-pilzen", { ingredients: ["Champignons"] });
    const wrongSlot = recipe("abend", { mealSlots: ["DINNER"] });
    const usage = new Map([["benutzt", 3]]);
    expect(selectRecipeForSlot([disliked, wrongSlot, used], target, [], ["Champignons"], new Set(), usage)?.id).toBe("benutzt");
  });

  it("nutzt die Wochenverwendung auch im Fallback, wenn alle Tages-Kandidaten schon benutzt sind", () => {
    const a = recipe("a");
    const b = recipe("b");
    const usage = new Map([["a", 2]]);
    expect(selectRecipeForSlot([a, b], target, [], [], new Set(["a", "b"]), usage)?.id).toBe("b");
  });

  it("verändert die übergebene Wochenverwendung nicht selbst", () => {
    const usage = new Map([["a", 1]]);
    selectRecipeForSlot([recipe("a"), recipe("b")], target, [], [], new Set(), usage);
    expect([...usage.entries()]).toEqual([["a", 1]]);
  });
});

describe("dayMacroDeviation", () => {
  const daily = { kcal: 2000, proteinG: 100, carbsG: 250, fatG: 60 };
  const meal = (kcal: number, proteinG: number, carbsG: number, fatG: number): RecipeCandidate =>
    recipe("x", { kcal, proteinG, carbsG, fatG });

  it("ist 0, wenn die Tagessumme alle vier Ziele exakt trifft", () => {
    expect(dayMacroDeviation(daily, [{ recipe: meal(1000, 50, 125, 30), scale: 2 }])).toBeCloseTo(0);
  });

  it("ist die mittlere relative Abweichung über Kalorien, Protein, Carbs und Fett", () => {
    // Überall 10 % zu viel.
    expect(dayMacroDeviation(daily, [{ recipe: meal(2200, 110, 275, 66), scale: 1 }])).toBeCloseTo(0.1);
    // Nur Protein 40 % zu wenig: (0 + 0.4 + 0 + 0) / 4.
    expect(dayMacroDeviation(daily, [{ recipe: meal(2000, 60, 250, 60), scale: 1 }])).toBeCloseTo(0.1);
  });

  it("zählt zu wenig und zu viel gleich", () => {
    const under = dayMacroDeviation(daily, [{ recipe: meal(1800, 90, 225, 54), scale: 1 }]);
    const over = dayMacroDeviation(daily, [{ recipe: meal(2200, 110, 275, 66), scale: 1 }]);
    expect(under).toBeCloseTo(over);
  });

  it("berücksichtigt die Portionsgröße", () => {
    const item = meal(1000, 50, 125, 30);
    expect(dayMacroDeviation(daily, [{ recipe: item, scale: 1 }])).toBeCloseTo(0.5);
    expect(dayMacroDeviation(daily, [{ recipe: item, scale: 2 }])).toBeCloseTo(0);
  });
});

describe("buildDayPlan: Trainingstage bleiben unverändert (Variety wirkt nur in der Rezeptwahl)", () => {
  const daily = { kcal: 2400, proteinG: 150, carbsG: 280, fatG: 70 };

  it("ohne Training: fünf Standard-Slots", () => {
    expect(buildDayPlan(daily).map((s) => `${s.time} ${s.slot}`)).toEqual([
      "08:00 BREAKFAST",
      "10:30 SNACK",
      "13:00 LUNCH",
      "16:00 SNACK",
      "19:30 DINNER",
    ]);
  });

  it("mit Training um 18:00 (60 Min): Pre-/Post-Workout ersetzen die überlappenden Mahlzeiten", () => {
    const slots = buildDayPlan(daily, { startTime: "18:00", durationMin: 60, sportType: "STRENGTH" });
    expect(slots.map((s) => `${s.time} ${s.slot}`)).toEqual([
      "08:00 BREAKFAST",
      "10:30 SNACK",
      "13:00 LUNCH",
      "15:30 PRE_WORKOUT",
      "19:30 POST_WORKOUT",
    ]);
  });
});
