import { SLOT_LABELS, WEEKDAY_LABELS } from "./labels";
import type { DbRecipeLike } from "./recipeDetail";

/**
 * Reine Aufbereitung des persönlichen Wochenplans (MealPlanDay/MealPlanItem)
 * für die Ledger-Ansicht auf /plan. Kein Zugriff auf DB oder Planer: die
 * Daten kommen fertig von getOrGenerateWeekPlan(), hier wird nur beschriftet,
 * summiert und gruppiert.
 */

const MONTH_LABELS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

/** Slots, die die Tageszeile als "Hauptmahlzeiten" zusammenfasst; alles andere zählt als "weitere". */
const MAIN_SLOTS = new Set(["BREAKFAST", "LUNCH", "DINNER"]);
const TRAINING_SLOTS = new Set(["PRE_WORKOUT", "POST_WORKOUT"]);

/** Ab dieser Abweichung von 1x wird die Portionsgröße angezeigt (wie im Rezept-Dialog). */
const PORTION_DISPLAY_THRESHOLD = 0.05;

export interface LedgerPlanItem {
  id: string;
  slot: string;
  time: string;
  portionMultiplier: number;
  recipe: { id: string; name: string; kcal: number };
}

export interface LedgerMeal {
  id: string;
  time: string;
  slot: string;
  /** Beschriftung aus dem tatsächlichen Slot-Typ des Planers, nie aus der Uhrzeit abgeleitet. */
  slotLabel: string;
  recipeId: string;
  name: string;
  /** Kalorien der geplanten Portion (Rezept-kcal x Portionsfaktor), gerundet. */
  kcal: number;
  portionMultiplier: number;
}

export interface LedgerDay {
  /** Lokales Datum als JJJJ-MM-TT. */
  key: string;
  weekdayShort: string;
  weekdayLabel: string;
  dayOfMonth: number;
  dateLabel: string;
  isToday: boolean;
  hasTraining: boolean;
  kcalTotal: number;
  /** Rezeptnamen der Hauptmahlzeiten (bei Tagen ohne Hauptmahlzeit die ersten Mahlzeiten), kommagetrennt. */
  headline: string;
  /** Anzahl der Mahlzeiten, die die Headline nicht nennt. */
  extraCount: number;
  meals: LedgerMeal[];
}

export interface WeekLedger {
  rangeLabel: string;
  days: LedgerDay[];
  /** Heute, sofern heute in dieser Woche liegt und einen Plan hat, sonst kein Tag. */
  initialOpenKey: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "14.–20. September", "28. September–4. Oktober" oder mit Jahren, wenn die Woche den Jahreswechsel überspannt. */
export function formatWeekRange(start: Date, end: Date): string {
  const startMonth = MONTH_LABELS[start.getMonth()];
  const endMonth = MONTH_LABELS[end.getMonth()];
  if (start.getFullYear() !== end.getFullYear()) {
    return `${start.getDate()}. ${startMonth} ${start.getFullYear()}–${end.getDate()}. ${endMonth} ${end.getFullYear()}`;
  }
  if (start.getMonth() !== end.getMonth()) {
    return `${start.getDate()}. ${startMonth}–${end.getDate()}. ${endMonth}`;
  }
  return `${start.getDate()}.–${end.getDate()}. ${endMonth}`;
}

/** Ohne abschließenden Klammerzusatz: "Rice Paper Dumplings (Knusprige Reispapier-Taschen)" -> "Rice Paper Dumplings". */
export function shortRecipeName(name: string): string {
  const short = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return short || name;
}

/** "×1,4 Portion" oder `null`, wenn die Portion (fast) dem Originalrezept entspricht. */
export function formatPortionLabel(multiplier: number): string | null {
  if (Math.abs(multiplier - 1) <= PORTION_DISPLAY_THRESHOLD) return null;
  return `×${multiplier.toFixed(1).replace(".", ",")} Portion`;
}

function buildMeals(items: LedgerPlanItem[]): LedgerMeal[] {
  return [...items]
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((item) => ({
      id: item.id,
      time: item.time,
      slot: item.slot,
      slotLabel: SLOT_LABELS[item.slot] ?? item.slot,
      recipeId: item.recipe.id,
      name: item.recipe.name,
      kcal: Math.round(item.recipe.kcal * item.portionMultiplier),
      portionMultiplier: item.portionMultiplier,
    }));
}

function buildHeadline(meals: LedgerMeal[]): { headline: string; extraCount: number } {
  const main = meals.filter((m) => MAIN_SLOTS.has(m.slot));
  const shown = main.length > 0 ? main : meals.slice(0, 3);
  return {
    headline: shown.map((m) => shortRecipeName(m.name)).join(", "),
    extraCount: meals.length - shown.length,
  };
}

/**
 * `plans` sind die Tage ab `weekStart` (Montag) in Reihenfolge, wie sie
 * getOrGenerateWeekPlan() liefert. `today` bestimmt, welcher Tag als heute
 * gilt und standardmäßig geöffnet ist.
 */
export function buildWeekLedger({
  weekStart,
  plans,
  today,
}: {
  weekStart: Date;
  plans: { items: LedgerPlanItem[] }[];
  today: Date;
}): WeekLedger {
  const todayKey = dayKey(today);

  const days: LedgerDay[] = plans.map((plan, i) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + i);

    const meals = buildMeals(plan.items);
    const { headline, extraCount } = buildHeadline(meals);
    const kcalTotal = Math.round(plan.items.reduce((sum, item) => sum + item.recipe.kcal * item.portionMultiplier, 0));

    return {
      key: dayKey(date),
      weekdayShort: WEEKDAY_LABELS[i]?.slice(0, 2) ?? "",
      weekdayLabel: WEEKDAY_LABELS[i] ?? "",
      dayOfMonth: date.getDate(),
      dateLabel: `${date.getDate()}. ${MONTH_LABELS[date.getMonth()]}`,
      isToday: dayKey(date) === todayKey,
      hasTraining: plan.items.some((item) => TRAINING_SLOTS.has(item.slot)),
      kcalTotal,
      headline,
      extraCount,
      meals,
    };
  });

  const last = new Date(weekStart);
  last.setDate(weekStart.getDate() + Math.max(plans.length - 1, 0));

  const todayDay = days.find((d) => d.isToday);
  return {
    rangeLabel: formatWeekRange(weekStart, last),
    days,
    initialOpenKey: todayDay && todayDay.meals.length > 0 ? todayDay.key : null,
  };
}

/** Es ist immer höchstens ein Tag offen: ein anderer Tag ersetzt den offenen, derselbe Tag schließt ihn. */
export function toggleOpenDay(current: string | null, key: string): string | null {
  return current === key ? null : key;
}

/**
 * Ordnet Insights dem Tag zu, in dem ihre Quell-Mahlzeit (`source.id` =
 * MealPlanItem-ID) liegt. Insights ohne passende Mahlzeit bleiben in `unassigned`,
 * damit keines verloren geht.
 */
export function assignInsightsToDays<T extends { source: { id: string } }>(
  days: LedgerDay[],
  insights: T[],
): { byDay: Record<string, T[]>; unassigned: T[] } {
  const dayByMealId = new Map<string, string>();
  for (const day of days) for (const meal of day.meals) dayByMealId.set(meal.id, day.key);

  const byDay: Record<string, T[]> = {};
  const unassigned: T[] = [];
  for (const insight of insights) {
    const key = dayByMealId.get(insight.source.id);
    if (key) (byDay[key] ??= []).push(insight);
    else unassigned.push(insight);
  }
  return { byDay, unassigned };
}

/** Nur die Felder eines Rezepts, die der Rezept-Dialog braucht. */
export type PlanRecipe = Pick<
  DbRecipeLike,
  | "id"
  | "name"
  | "description"
  | "kcal"
  | "proteinG"
  | "carbsG"
  | "fatG"
  | "prepTimeMin"
  | "totalTimeMin"
  | "servings"
  | "ingredients"
  | "instructions"
  | "isTrending"
  | "trendSource"
  | "tags"
>;

/**
 * Jedes Rezept der Woche genau einmal (nicht je Mahlzeit): Zutaten und Schritte
 * stehen so nur einmal in den Seitendaten, auch wenn ein Rezept mehrfach
 * vorkommt. Die Portion wird erst beim Öffnen angewendet.
 */
export function collectPlanRecipes(plans: { items: { recipe: PlanRecipe }[] }[]): Record<string, PlanRecipe> {
  const recipes: Record<string, PlanRecipe> = {};
  for (const plan of plans) {
    for (const { recipe } of plan.items) {
      if (recipes[recipe.id]) continue;
      recipes[recipe.id] = {
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        kcal: recipe.kcal,
        proteinG: recipe.proteinG,
        carbsG: recipe.carbsG,
        fatG: recipe.fatG,
        prepTimeMin: recipe.prepTimeMin,
        totalTimeMin: recipe.totalTimeMin,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions,
        isTrending: recipe.isTrending,
        trendSource: recipe.trendSource,
        tags: recipe.tags,
      };
    }
  }
  return recipes;
}
