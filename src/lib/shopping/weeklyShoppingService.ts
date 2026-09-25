import { addDays, startOfWeek, todayForUser, toDbDate, type CalendarDate } from "../calendarDate";
import { prisma } from "../db";
import { getHouseholdIdForProfile } from "../household";
import { getHouseholdRotation } from "../rotation/rotationService";
import type { MealForAggregation } from "../mealPrep/aggregation";
import type { PantryItemForMatch } from "../mealPrep/enrichment";
import type { FoodCatalog } from "../recipes/catalog";
import { loadFoodCatalog } from "../recipes/recipeService";
import type { RotationUrgency } from "../rotation/types";
import { calculateWeeklyShopping, type WeeklyShoppingCalculation } from "./weeklyShopping";

export interface WeeklyShoppingResult extends WeeklyShoppingCalculation {
  /** Montag der berechneten Woche (Kalendertag des Nutzers). */
  weekStart: CalendarDate;
  /** Sonntag der berechneten Woche. */
  weekEnd: CalendarDate;
  /** Für wie viele der 7 Tage bereits ein Plan existiert (Rest fließt NICHT ein, siehe getWeeklyShoppingForProfile). */
  plannedDays: number;
}

/** Woche Montag bis Sonntag, in der der Kalendertag `day` liegt - wie sie auch /plan darstellt. */
export function weekRangeFor(day: CalendarDate): { start: CalendarDate; end: CalendarDate } {
  const start = startOfWeek(day);
  return { start, end: addDays(start, 6) };
}

/**
 * Einkaufsbedarf einer Woche aus dem PERSÖNLICHEN Tagesplan (MealPlanDay /
 * MealPlanItem, derselbe Plan wie /plan und /dashboard). Der HAUSHALTS-Planer
 * (MealPlan / MealPlanMeal, /meal-plans) wird hier bewusst nicht gelesen; die
 * Berechnung selbst (calculateWeeklyShopping) nimmt nur MealForAggregation
 * und ließe sich später mit derselben Abbildung auch darauf anwenden.
 *
 * Rein lesend: erzeugt NIE einen MealPlanDay (das bleibt getOrGenerateDayPlan(),
 * das /plan beim Öffnen aufruft). Tage ohne Plan fließen nicht ein, `plannedDays`
 * macht das sichtbar.
 *
 * Der Vorrat gehört dem Haushalt des Profils; ohne Haushalt gilt er als leer,
 * alles gilt dann als fehlend. Der Vorrat wird nur gelesen, nie verändert.
 */
export async function getWeeklyShoppingForProfile(
  profileId: string,
  /** Ein Kalendertag der gewünschten Woche; ohne Angabe die Woche von heute (Nutzerzeit). */
  day?: CalendarDate,
  now: Date = new Date(),
): Promise<WeeklyShoppingResult> {
  const { start, end } = weekRangeFor(day ?? todayForUser(now));

  const [days, householdId] = await Promise.all([
    prisma.mealPlanDay.findMany({
      where: { profileId, date: { gte: toDbDate(start), lte: toDbDate(end) } },
      include: { items: { include: { recipe: true } } },
      orderBy: { date: "asc" },
    }),
    getHouseholdIdForProfile(profileId),
  ]);

  const meals: MealForAggregation[] = days.flatMap((day) =>
    day.items.map((item) => ({
      id: item.id,
      date: day.date,
      slot: item.slot,
      recipeId: item.recipeId,
      recipeName: item.recipe.name,
      ingredients: JSON.parse(item.recipe.ingredients) as string[],
      portionMultiplier: item.portionMultiplier,
    })),
  );

  let pantryItems: PantryItemForMatch[] = [];
  let urgencyByItemId = new Map<string, RotationUrgency>();
  let catalog: FoodCatalog | undefined;
  if (householdId) {
    const [items, rotation, foodCatalog] = await Promise.all([
      prisma.pantryItem.findMany({
        where: { householdId },
        select: { id: true, name: true, ingredientId: true, remainingQuantity: true, unit: true },
      }),
      getHouseholdRotation(householdId, now),
      loadFoodCatalog(),
    ]);
    pantryItems = items;
    urgencyByItemId = new Map(rotation.results.map((r) => [r.pantryItemId, r.urgency]));
    catalog = foodCatalog;
  }

  return {
    weekStart: start,
    weekEnd: end,
    plannedDays: days.filter((d) => d.items.length > 0).length,
    ...calculateWeeklyShopping(meals, pantryItems, urgencyByItemId, catalog),
  };
}
