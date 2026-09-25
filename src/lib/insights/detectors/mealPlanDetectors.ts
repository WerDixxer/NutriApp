import type { PantryUnit } from "@prisma/client";
import { daysBetween, fromDbDate, todayForUser, weekdayIndex } from "../../calendarDate";
import { aggregateIngredients, type MealForAggregation } from "../../mealPrep/aggregation";
import { enrichAggregatedIngredients, pantryItemMatchesIngredient, type PantryItemForMatch } from "../../mealPrep/enrichment";
import { normalizeIngredientKey, parseIngredientLine } from "../../mealPrep/ingredientParser";
import type { FoodCatalog } from "../../recipes/catalog";
import { SLOT_LABELS, WEEKDAY_LABELS } from "../../labels";
import type { Insight } from "../types";

export interface MealPlanInsightItem {
  id: string;
  /** Kalendertag der Mahlzeit als DB-Wert (MealPlanDay.date, UTC-Mitternacht, siehe calendarDate.ts). */
  date: Date;
  slot: string;
  recipeId: string;
  recipeName: string;
  ingredients: string[];
  portionMultiplier: number;
}

export interface PantryInsightStock {
  id: string;
  name: string;
  /** Verknüpftes zentrales Food/Ingredient; fehlt bei freien Items. */
  ingredientId?: string | null;
  remainingQuantity: number;
  unit: PantryUnit;
  expirationDate: Date | null;
}

/**
 * Die meisten Rezepte brauchen frische Zutaten, die niemand tagelang auf
 * Vorrat hat (Milch, Kräuter, ...) - "es fehlt fast alles" ist deshalb für
 * fast jede Mahlzeit trivial wahr und keine echte Information (Kapitel-
 * Auftrag Abschnitt 16: nichts sagen statt Nutzen vortäuschen). Relevant
 * wird es erst, wenn NUR WENIGES fehlt ("noch 2 Zutaten", wie im Beispiel des
 * Auftrags) - dann ist es ein konkreter, handlungsfähiger Hinweis statt einer
 * Selbstverständlichkeit.
 */
const MAX_MISSING_FOR_INSIGHT = 2;

/** Kalendertage vom heutigen Tag des Nutzers (`now` ist ein Zeitpunkt) bis zum Tag der Mahlzeit. */
function daysUntilMeal(meal: MealPlanInsightItem, now: Date): number {
  return daysBetween(todayForUser(now), fromDbDate(meal.date));
}

/** Wochentag eines als Kalendertag gespeicherten Datums (Mahlzeit, Ablaufdatum). */
function weekdayLabel(storedDate: Date): string {
  return WEEKDAY_LABELS[weekdayIndex(fromDbDate(storedDate))];
}

function toMatchInput(pantryItems: PantryInsightStock[]): PantryItemForMatch[] {
  return pantryItems.map((p) => ({
    id: p.id,
    name: p.name,
    ingredientId: p.ingredientId,
    remainingQuantity: p.remainingQuantity,
    unit: p.unit,
  }));
}

/**
 * Fehlende UND vollständig gedeckte Zutaten teilen sich dieselbe Grundlage
 * (aggregateIngredients()/enrichAggregatedIngredients() aus mealPrep/, siehe
 * Kapitel-Auftrag "keine doppelte Darstellung derselben Information") -
 * angewendet auf GENAU EINE Mahlzeit statt eines ganzen Plans. Nur Zeilen,
 * die ingredientParser.ts strukturiert erkennt, fließen ein; unstrukturierte
 * Zeilen (z.B. "Salz, Pfeffer") werden nie als "fehlend" behauptet.
 */
function evaluateMealCoverage(meal: MealPlanInsightItem, pantryItems: PantryInsightStock[], catalog?: FoodCatalog) {
  const mealForAggregation: MealForAggregation = {
    id: meal.id,
    date: meal.date,
    slot: meal.slot,
    recipeId: meal.recipeId,
    recipeName: meal.recipeName,
    ingredients: meal.ingredients,
    portionMultiplier: meal.portionMultiplier,
  };
  const { aggregated } = aggregateIngredients([mealForAggregation]);
  if (aggregated.length === 0) return null;

  const enriched = enrichAggregatedIngredients(aggregated, toMatchInput(pantryItems), new Map(), new Map(), catalog);
  const missing = enriched.filter((i) => !i.pantry || i.pantry.availableQuantity < i.totalQuantity);
  return { enriched, missing };
}

/**
 * Nur für HEUTE (Kapitel-Auftrag Abschnitt 6: ein Insight braucht einen Grund,
 * JETZT zu erscheinen) - eine Warnung für ein Essen in 5 Tagen wäre verfrüht,
 * siehe Beispiel im Auftrag.
 */
export function detectMealMissingIngredients(
  meals: MealPlanInsightItem[],
  pantryItems: PantryInsightStock[],
  now: Date = new Date(),
  catalog?: FoodCatalog,
): Insight[] {
  const insights: Insight[] = [];

  for (const meal of meals) {
    if (daysUntilMeal(meal, now) !== 0) continue;
    const coverage = evaluateMealCoverage(meal, pantryItems, catalog);
    if (!coverage || coverage.missing.length === 0 || coverage.missing.length > MAX_MISSING_FOR_INSIGHT) continue;

    const slotLabel = SLOT_LABELS[meal.slot] ?? meal.slot;
    const names = coverage.missing.map((i) => i.displayName).join(", ");
    const message =
      coverage.missing.length === 1
        ? `Für ${meal.recipeName} heute fehlt noch ${names}.`
        : `Für ${meal.recipeName} heute fehlen noch ${coverage.missing.length} Zutaten: ${names}.`;

    insights.push({
      id: `mealplan:missing:${meal.id}`,
      type: "MEAL_PLAN_MISSING_INGREDIENTS",
      category: "MEAL_PLAN",
      priority: "important",
      message,
      context: { mealPlanItemId: meal.id, recipeName: meal.recipeName, slot: slotLabel, missingCount: coverage.missing.length },
      source: { entity: "MealPlanItem", id: meal.id },
      surfaces: ["DASHBOARD", "PLAN"],
      action: { label: "Vorräte ansehen", href: "/pantry" },
      detectedAt: now,
      expiresAt: meal.date,
    });
  }

  return insights;
}

/** Positives Gegenstück zu detectMealMissingIngredients() - ebenfalls nur für heute. */
export function detectMealFullyCovered(
  meals: MealPlanInsightItem[],
  pantryItems: PantryInsightStock[],
  now: Date = new Date(),
  catalog?: FoodCatalog,
): Insight[] {
  const insights: Insight[] = [];

  for (const meal of meals) {
    if (daysUntilMeal(meal, now) !== 0) continue;
    const coverage = evaluateMealCoverage(meal, pantryItems, catalog);
    if (!coverage || coverage.missing.length > 0) continue;

    insights.push({
      id: `mealplan:covered:${meal.id}`,
      type: "MEAL_PLAN_FULLY_COVERED",
      category: "MEAL_PLAN",
      priority: "useful",
      message: `Du hast schon alles für ${meal.recipeName} heute da.`,
      context: { mealPlanItemId: meal.id, recipeName: meal.recipeName },
      source: { entity: "MealPlanItem", id: meal.id },
      surfaces: ["DASHBOARD"],
      detectedAt: now,
      expiresAt: meal.date,
    });
  }

  return insights;
}

/**
 * Sucht für JEDE geplante Mahlzeit im Zeitfenster nach Zutaten, deren
 * passender Pantry-Bestand VOR dem Mahlzeit-Datum abläuft - ein echter
 * Konflikt, den weder die reine Pantry-Ablaufwarnung (kennt den Plan nicht)
 * noch die Coverage-Prüfung oben (kennt nur Menge, kein Ablaufdatum pro
 * Zutat) allein erkennen. Derselbe Abgleich wie enrichment.ts
 * (pantryItemMatchesIngredient: Food-ID, sonst Namen), hier zusätzlich mit
 * dem Ablaufdatum verglichen.
 */
export function detectMealIngredientExpiresBeforeMeal(
  meals: MealPlanInsightItem[],
  pantryItems: PantryInsightStock[],
  now: Date = new Date(),
  catalog?: FoodCatalog,
): Insight[] {
  const insights: Insight[] = [];

  for (const meal of meals) {
    const daysUntil = daysUntilMeal(meal, now);
    if (daysUntil < 0) continue; // Mahlzeit liegt in der Vergangenheit

    for (const raw of meal.ingredients) {
      const parsed = parseIngredientLine(raw);
      if (!parsed) continue;
      const normalizedName = normalizeIngredientKey(parsed.name);

      for (const item of pantryItems) {
        if (item.remainingQuantity <= 0 || !item.expirationDate) continue;
        if (!pantryItemMatchesIngredient(item, normalizedName, catalog)) continue;
        if (fromDbDate(item.expirationDate) >= fromDbDate(meal.date)) continue; // Kalendertage "JJJJ-MM-TT" sind lexikografisch sortierbar

        const slotLabel = SLOT_LABELS[meal.slot] ?? meal.slot;
        const weekday = weekdayLabel(meal.date);
        const expiryWeekday = weekdayLabel(item.expirationDate);
        const message = `Das für ${weekday} geplante ${item.name} läuft schon am ${expiryWeekday} ab.`;

        insights.push({
          id: `mealplan:expiry-conflict:${meal.id}:${item.id}`,
          type: "MEAL_PLAN_INGREDIENT_EXPIRES_BEFORE_MEAL",
          category: "MEAL_PLAN",
          priority: daysUntil <= 1 ? "critical" : "important",
          message,
          context: {
            mealPlanItemId: meal.id,
            pantryItemId: item.id,
            recipeName: meal.recipeName,
            slot: slotLabel,
            mealDate: meal.date.toISOString(),
            expirationDate: item.expirationDate.toISOString(),
          },
          source: { entity: "MealPlanItem", id: meal.id },
          surfaces: ["DASHBOARD", "PLAN"],
          action: { label: "Wochenplan ansehen", href: "/plan" },
          detectedAt: now,
          expiresAt: meal.date,
        });
      }
    }
  }

  return insights;
}
