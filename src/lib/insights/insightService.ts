import { prisma } from "../db";
import { matchesAllergen } from "../foodMatching";
import { getBudgetSummary } from "../budget/budgetService";
import { detectPantryExpired, detectPantryExpiringSoon } from "./detectors/pantryDetectors";
import {
  detectMealFullyCovered,
  detectMealIngredientExpiresBeforeMeal,
  detectMealMissingIngredients,
  type MealPlanInsightItem,
  type PantryInsightStock,
} from "./detectors/mealPlanDetectors";
import { detectBudgetInsights } from "./detectors/budgetDetectors";
import { detectRecipesMatchingAvailablePantry, type RecipeInsightCandidate } from "./detectors/recipeDetectors";
import { dedupeAndSortInsights, excludeDismissed } from "./dedupe";
import type { Insight } from "./types";

const MEAL_PLAN_LOOKAHEAD_DAYS = 6;
const RECIPE_CANDIDATE_LIMIT = 200;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Der EINE Einstiegspunkt für alle vier Oberflächen (Dashboard/Pantry/Plan/
 * Budget, siehe Kapitel-Auftrag Abschnitt 10/11): lädt alles, was die
 * Detektoren brauchen, führt sie aus, entfernt bereits abgewiesene Insights
 * und liefert eine einzige, nach Priorität sortierte Liste zurück. Jede Seite
 * filtert sich mit `forSurface()` (dedupe.ts) selbst die für sie relevante
 * Teilmenge heraus - keine zweite, seiteneigene Berechnung.
 *
 * Rein lesend: erzeugt NIE einen MealPlanDay (das bleibt Aufgabe von
 * getOrGenerateDayPlan(), siehe generateMealPlan.ts) - wurde ein Tag noch nie
 * aufgerufen, liefert dieser Dienst für ihn schlicht keine Meal-Plan-Insights,
 * statt ihn als Seiteneffekt selbst zu erzeugen.
 */
export async function getInsightsForProfile(profileId: string, now: Date = new Date()): Promise<Insight[]> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    include: { allergies: true, user: { select: { id: true } } },
  });
  if (!profile) return [];

  const membership = await prisma.householdMember.findUnique({
    where: { userId: profile.userId },
    select: { householdId: true },
  });

  const insights: Insight[] = [];

  if (membership) {
    const householdId = membership.householdId;
    const today = startOfDay(now);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + MEAL_PLAN_LOOKAHEAD_DAYS);

    const [pantryItems, budgetSummary, mealPlanDays, recipes] = await Promise.all([
      prisma.pantryItem.findMany({
        where: { householdId },
        select: { id: true, name: true, remainingQuantity: true, unit: true, expirationDate: true },
      }),
      getBudgetSummary(householdId, now),
      prisma.mealPlanDay.findMany({
        where: { profileId, date: { gte: today, lte: windowEnd } },
        include: { items: { include: { recipe: true } } },
      }),
      prisma.recipe.findMany({
        where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
        take: RECIPE_CANDIDATE_LIMIT,
      }),
    ]);

    const pantryStock: PantryInsightStock[] = pantryItems;

    insights.push(...detectPantryExpiringSoon(pantryStock, now));
    insights.push(...detectPantryExpired(pantryStock, now));

    const mealItems: MealPlanInsightItem[] = mealPlanDays.flatMap((day) =>
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

    insights.push(...detectMealMissingIngredients(mealItems, pantryStock, now));
    insights.push(...detectMealFullyCovered(mealItems, pantryStock, now));
    insights.push(...detectMealIngredientExpiresBeforeMeal(mealItems, pantryStock, now));

    insights.push(...detectBudgetInsights(budgetSummary, now));

    const allergyLabels = profile.allergies.map((a) => a.label);
    const recipeCandidates: RecipeInsightCandidate[] = recipes
      .filter((r) => {
        const dietTypes = JSON.parse(r.dietTypes) as string[];
        const allergens = JSON.parse(r.allergens) as string[];
        if (!dietTypes.includes(profile.dietType)) return false;
        if (matchesAllergen(allergens, allergyLabels)) return false;
        return true;
      })
      .map((r) => ({ id: r.id, name: r.name, ingredients: JSON.parse(r.ingredients) as string[] }));

    insights.push(
      ...detectRecipesMatchingAvailablePantry(
        recipeCandidates,
        pantryStock.map((p) => ({ id: p.id, name: p.name, remainingQuantity: p.remainingQuantity, unit: p.unit })),
        now,
      ),
    );
  }

  const dismissed = await prisma.dismissedInsight.findMany({ where: { profileId }, select: { insightKey: true } });
  const dismissedKeys = new Set(dismissed.map((d) => d.insightKey));

  return dedupeAndSortInsights(excludeDismissed(insights, dismissedKeys));
}
