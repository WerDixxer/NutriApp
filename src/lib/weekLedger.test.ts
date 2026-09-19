import { describe, expect, it } from "vitest";
import {
  assignInsightsToDays,
  buildWeekLedger,
  collectPlanRecipes,
  dayKey,
  formatPortionLabel,
  formatWeekRange,
  shortRecipeName,
  toggleOpenDay,
  type LedgerPlanItem,
  type PlanRecipe,
} from "./weekLedger";

const MONDAY = new Date(2026, 8, 14); // Montag, 14. September 2026
const FRIDAY = new Date(2026, 8, 18);

let counter = 0;
function item(slot: string, time: string, name: string, kcal: number, portionMultiplier = 1): LedgerPlanItem {
  counter += 1;
  return { id: `item-${counter}`, slot, time, portionMultiplier, recipe: { id: `recipe-${name}`, name, kcal } };
}

function standardDay(): LedgerPlanItem[] {
  return [
    item("BREAKFAST", "08:00", "Protein Pancakes", 450),
    item("SNACK", "10:30", "Rice Paper Dumplings (Knusprige Reispapier-Taschen)", 410, 0.5),
    item("LUNCH", "13:00", "Udon-Salat", 520, 1.4),
    item("SNACK", "16:00", "Reiswaffeln", 210),
    item("DINNER", "19:30", "Baked Feta Pasta", 640),
  ];
}

function week(overrides: Record<number, LedgerPlanItem[]> = {}) {
  return Array.from({ length: 7 }, (_, i) => ({ items: overrides[i] ?? standardDay() }));
}

describe("buildWeekLedger: Woche und Kopfzeile", () => {
  it("bildet sieben Tage von Montag bis Sonntag ab", () => {
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY });

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.weekdayShort)).toEqual(["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]);
    expect(days.map((d) => d.weekdayLabel)).toEqual(["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]);
    expect(days.map((d) => d.dayOfMonth)).toEqual([14, 15, 16, 17, 18, 19, 20]);
    expect(days[0].key).toBe("2026-09-14");
    expect(days[6].key).toBe("2026-09-20");
    expect(days[4].dateLabel).toBe("18. September");
  });

  it("leitet den Datumsbereich aus der tatsächlichen Woche ab", () => {
    expect(buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY }).rangeLabel).toBe("14.–20. September");
  });

  it("formatiert Wochen über Monats- und Jahresgrenzen", () => {
    expect(formatWeekRange(new Date(2026, 8, 28), new Date(2026, 9, 4))).toBe("28. September–4. Oktober");
    expect(formatWeekRange(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe("28. Dezember 2026–3. Januar 2027");
    expect(formatWeekRange(new Date(2026, 1, 23), new Date(2026, 2, 1))).toBe("23. Februar–1. März");
  });

  it("nimmt Monatsgrenzen mitten in der Woche korrekt mit", () => {
    const ledger = buildWeekLedger({ weekStart: new Date(2026, 8, 28), plans: week(), today: FRIDAY });
    expect(ledger.days.map((d) => d.dayOfMonth)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(ledger.days[3].dateLabel).toBe("1. Oktober");
    expect(ledger.rangeLabel).toBe("28. September–4. Oktober");
  });
});

describe("buildWeekLedger: heute", () => {
  it("erkennt genau den heutigen Tag, unabhängig von der Uhrzeit", () => {
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: new Date(2026, 8, 18, 22, 45) });
    expect(days.filter((d) => d.isToday).map((d) => d.key)).toEqual(["2026-09-18"]);
  });

  it("öffnet standardmäßig heute", () => {
    expect(buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY }).initialOpenKey).toBe("2026-09-18");
  });

  it("öffnet keinen Tag, wenn heute nicht in der Woche liegt", () => {
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: new Date(2026, 8, 25) });
    expect(ledger.days.some((d) => d.isToday)).toBe(false);
    expect(ledger.initialOpenKey).toBeNull();
  });

  it("öffnet keinen Tag, wenn heute keinen Plan hat", () => {
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 4: [] }), today: FRIDAY });
    expect(ledger.days[4].isToday).toBe(true);
    expect(ledger.initialOpenKey).toBeNull();
  });
});

describe("buildWeekLedger: Mahlzeiten", () => {
  const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY });
  const meals = days[0].meals;

  it("behält Zeiten und Reihenfolge", () => {
    expect(meals.map((m) => m.time)).toEqual(["08:00", "10:30", "13:00", "16:00", "19:30"]);
  });

  it("sortiert nach Uhrzeit, auch wenn der Plan anders geliefert wird", () => {
    const shuffled = [item("DINNER", "19:30", "B", 100), item("BREAKFAST", "08:00", "A", 100)];
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: shuffled }), today: FRIDAY });
    expect(ledger.days[0].meals.map((m) => m.time)).toEqual(["08:00", "19:30"]);
  });

  it("beschriftet nach dem tatsächlichen Slot-Typ, nicht nach der Uhrzeit", () => {
    // 13:00 ist hier bewusst ein Snack, 08:00 ein Abendessen: die Beschriftung folgt dem Slot.
    const odd = [item("DINNER", "08:00", "A", 100), item("SNACK", "13:00", "B", 100), item("BREAKFAST", "19:30", "C", 100)];
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: odd }), today: FRIDAY });
    expect(ledger.days[0].meals.map((m) => m.slotLabel)).toEqual(["Abendessen", "Snack", "Frühstück"]);
  });

  it("verwendet die Labels aller Slots inklusive Vor-/Nach-dem-Training", () => {
    const all = [
      item("BREAKFAST", "08:00", "A", 100),
      item("SNACK", "10:30", "B", 100),
      item("LUNCH", "13:00", "C", 100),
      item("PRE_WORKOUT", "15:30", "D", 100),
      item("POST_WORKOUT", "19:00", "E", 100),
      item("DINNER", "20:00", "F", 100),
    ];
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: all }), today: FRIDAY });
    expect(ledger.days[0].meals.map((m) => m.slotLabel)).toEqual([
      "Frühstück",
      "Snack",
      "Mittagessen",
      "Vor dem Training",
      "Nach dem Training",
      "Abendessen",
    ]);
  });

  it("berechnet die Kalorien der Portion und behält den Portionsfaktor", () => {
    expect(meals[1]).toMatchObject({ kcal: 205, portionMultiplier: 0.5 });
    expect(meals[2]).toMatchObject({ kcal: 728, portionMultiplier: 1.4 });
    expect(meals[0]).toMatchObject({ kcal: 450, portionMultiplier: 1 });
  });

  it("behält Rezept-ID und vollständigen Rezeptnamen", () => {
    expect(meals[1].recipeId).toBe("recipe-Rice Paper Dumplings (Knusprige Reispapier-Taschen)");
    expect(meals[1].name).toBe("Rice Paper Dumplings (Knusprige Reispapier-Taschen)");
  });
});

describe("buildWeekLedger: Tageszusammenfassung", () => {
  it("summiert die Tageskalorien aus Rezept-kcal x Portion", () => {
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY });
    // 450 + 205 + 728 + 210 + 640
    expect(days[0].kcalTotal).toBe(2233);
  });

  it("rundet erst die Summe, nicht jede Mahlzeit", () => {
    const items = [item("BREAKFAST", "08:00", "A", 100.4), item("LUNCH", "13:00", "B", 100.4)];
    expect(buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: items }), today: FRIDAY }).days[0].kcalTotal).toBe(201);
  });

  it("nennt in der Headline die Hauptmahlzeiten mit gekürzten Namen und zählt die übrigen", () => {
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week(), today: FRIDAY });
    expect(days[0].headline).toBe("Protein Pancakes, Udon-Salat, Baked Feta Pasta");
    expect(days[0].extraCount).toBe(2);
  });

  it("fällt bei Tagen ohne Hauptmahlzeit auf die ersten Mahlzeiten zurück", () => {
    const items = [
      item("PRE_WORKOUT", "10:00", "A", 100),
      item("POST_WORKOUT", "12:00", "B", 100),
      item("SNACK", "14:00", "C", 100),
      item("SNACK", "16:00", "D", 100),
    ];
    const day = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: items }), today: FRIDAY }).days[0];
    expect(day.headline).toBe("A, B, C");
    expect(day.extraCount).toBe(1);
  });

  it("erkennt Trainingstage an Pre-/Post-Workout-Slots", () => {
    const training = [item("BREAKFAST", "08:00", "A", 100), item("PRE_WORKOUT", "15:30", "B", 100), item("POST_WORKOUT", "19:30", "C", 100)];
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week({ 2: training }), today: FRIDAY });
    expect(days.map((d) => d.hasTraining)).toEqual([false, false, true, false, false, false, false]);
  });

  it("stürzt bei einem Tag ohne Plan nicht ab und liefert leere Werte", () => {
    const { days } = buildWeekLedger({ weekStart: MONDAY, plans: week({ 2: [] }), today: FRIDAY });
    expect(days[2]).toMatchObject({ meals: [], kcalTotal: 0, headline: "", extraCount: 0, hasTraining: false });
    expect(days).toHaveLength(7);
  });

  it("stürzt auch bei einer komplett leeren Woche nicht ab", () => {
    const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }), today: FRIDAY });
    expect(ledger.days.every((d) => d.meals.length === 0)).toBe(true);
    expect(ledger.initialOpenKey).toBeNull();
  });
});

describe("Hilfsfunktionen", () => {
  it("dayKey verwendet das lokale Datum, nicht UTC", () => {
    expect(dayKey(new Date(2026, 8, 14, 0, 30))).toBe("2026-09-14");
    expect(dayKey(new Date(2026, 8, 14, 23, 59))).toBe("2026-09-14");
  });

  it("shortRecipeName entfernt nur einen abschließenden Klammerzusatz", () => {
    expect(shortRecipeName("Rice Paper Dumplings (Knusprige Reispapier-Taschen)")).toBe("Rice Paper Dumplings");
    expect(shortRecipeName("Salat (Beilage) mit Dressing")).toBe("Salat (Beilage) mit Dressing");
    expect(shortRecipeName("(Nur Klammer)")).toBe("(Nur Klammer)");
  });

  it("formatPortionLabel zeigt nur relevante Abweichungen von 1x", () => {
    expect(formatPortionLabel(1)).toBeNull();
    expect(formatPortionLabel(1.04)).toBeNull();
    expect(formatPortionLabel(0.96)).toBeNull();
    expect(formatPortionLabel(1.4)).toBe("×1,4 Portion");
    expect(formatPortionLabel(0.4)).toBe("×0,4 Portion");
    expect(formatPortionLabel(2.37)).toBe("×2,4 Portion");
  });
});

describe("toggleOpenDay: höchstens ein Tag ist offen", () => {
  it("öffnet einen Tag, wenn keiner offen ist", () => {
    expect(toggleOpenDay(null, "2026-09-14")).toBe("2026-09-14");
  });

  it("schließt den offenen Tag beim erneuten Klick", () => {
    expect(toggleOpenDay("2026-09-14", "2026-09-14")).toBeNull();
  });

  it("ersetzt den offenen Tag, statt einen zweiten zu öffnen", () => {
    expect(toggleOpenDay("2026-09-14", "2026-09-16")).toBe("2026-09-16");
  });

  it("hält über eine Klickfolge nie mehr als einen Tag offen", () => {
    const clicks = ["2026-09-14", "2026-09-15", "2026-09-15", "2026-09-16", "2026-09-14", "2026-09-14"];
    let open: string | null = "2026-09-18";
    const states: (string | null)[] = [];
    for (const key of clicks) {
      open = toggleOpenDay(open, key);
      states.push(open);
    }
    expect(states).toEqual(["2026-09-14", "2026-09-15", null, "2026-09-16", "2026-09-14", null]);
  });
});

describe("assignInsightsToDays", () => {
  const ledger = buildWeekLedger({ weekStart: MONDAY, plans: week({ 0: [item("LUNCH", "13:00", "A", 100)], 4: [item("LUNCH", "13:00", "B", 100)] }), today: FRIDAY });
  const mondayMeal = ledger.days[0].meals[0].id;
  const fridayMeal = ledger.days[4].meals[0].id;

  it("ordnet ein Insight dem Tag seiner Mahlzeit zu", () => {
    const insights = [
      { id: "a", source: { id: fridayMeal } },
      { id: "b", source: { id: mondayMeal } },
      { id: "c", source: { id: fridayMeal } },
    ];
    const { byDay, unassigned } = assignInsightsToDays(ledger.days, insights);
    expect(byDay["2026-09-18"].map((i) => i.id)).toEqual(["a", "c"]);
    expect(byDay["2026-09-14"].map((i) => i.id)).toEqual(["b"]);
    expect(unassigned).toEqual([]);
  });

  it("verliert kein Insight, dessen Mahlzeit nicht in der Woche liegt", () => {
    const { byDay, unassigned } = assignInsightsToDays(ledger.days, [{ id: "x", source: { id: "unbekannt" } }]);
    expect(byDay).toEqual({});
    expect(unassigned.map((i) => i.id)).toEqual(["x"]);
  });
});

describe("collectPlanRecipes", () => {
  function recipe(id: string): PlanRecipe {
    return {
      id,
      name: `Rezept ${id}`,
      description: "",
      kcal: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 15,
      prepTimeMin: 10,
      totalTimeMin: null,
      servings: 1,
      ingredients: '["100 g Reis"]',
      instructions: '["Kochen"]',
      isTrending: false,
      trendSource: null,
      tags: "[]",
    };
  }

  it("enthält jedes Rezept nur einmal, auch wenn es mehrfach geplant ist", () => {
    const plans = [
      { items: [{ recipe: recipe("a") }, { recipe: recipe("b") }] },
      { items: [{ recipe: recipe("a") }] },
    ];
    expect(Object.keys(collectPlanRecipes(plans)).sort()).toEqual(["a", "b"]);
  });

  it("überträgt nur die Felder des Rezept-Dialogs", () => {
    const withExtra = { ...recipe("a"), imageQuery: "pfanne", ownerProfileId: "p1", mealSlots: "[]" };
    const result = collectPlanRecipes([{ items: [{ recipe: withExtra }] }]);
    expect(Object.keys(result.a)).not.toContain("imageQuery");
    expect(Object.keys(result.a)).not.toContain("ownerProfileId");
    expect(result.a.ingredients).toBe('["100 g Reis"]');
  });

  it("liefert für eine Woche ohne Pläne ein leeres Objekt", () => {
    expect(collectPlanRecipes([{ items: [] }, { items: [] }])).toEqual({});
  });
});
