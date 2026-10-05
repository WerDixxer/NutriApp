import { addDays, todayForUser, toDbDate } from "../calendarDate";
import { prisma } from "../db";
import { fitsProfileHardRules } from "../foodMatching";
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
import { loadFoodCatalog } from "../recipes/recipeService";
import { readRecipeDietTypes, readRecipeStringList } from "../recipes/recipeJsonColumns";
import { skipUnreadableRows } from "../validation/jsonColumn";
import { dedupeAndSortInsights, excludeDismissed } from "./dedupe";
import type { Insight } from "./types";

const MEAL_PLAN_LOOKAHEAD_DAYS = 6;
const RECIPE_CANDIDATE_LIMIT = 200;

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
    const today = todayForUser(now);
    const windowEnd = addDays(today, MEAL_PLAN_LOOKAHEAD_DAYS);

    const [pantryItems, budgetSummary, mealPlanDays, recipes, catalog] = await Promise.all([
      prisma.pantryItem.findMany({
        where: { householdId },
        select: { id: true, name: true, ingredientId: true, remainingQuantity: true, unit: true, expirationDate: true },
      }),
      getBudgetSummary(householdId, now),
      prisma.mealPlanDay.findMany({
        where: { profileId, date: { gte: toDbDate(today), lte: toDbDate(windowEnd) } },
        include: { items: { include: { recipe: true } } },
      }),
      prisma.recipe.findMany({
        where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
        take: RECIPE_CANDIDATE_LIMIT,
      }),
      loadFoodCatalog(),
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
        ingredients: readRecipeStringList(item.recipe, "ingredients"),
        portionMultiplier: item.portionMultiplier,
      })),
    );

    insights.push(...detectMealMissingIngredients(mealItems, pantryStock, now, catalog));
    insights.push(...detectMealFullyCovered(mealItems, pantryStock, now, catalog));
    insights.push(...detectMealIngredientExpiresBeforeMeal(mealItems, pantryStock, now, catalog));

    insights.push(...detectBudgetInsights(budgetSummary, now));

    const allergyLabels = profile.allergies.map((a) => a.label);
    // Ein Rezept mit unlesbarer JSON-Spalte fällt mit Warnung aus dem Kandidaten-Pool (R5D).
    const recipeCandidates: RecipeInsightCandidate[] = skipUnreadableRows(recipes, (r) => ({
      id: r.id,
      name: r.name,
      dietTypes: readRecipeDietTypes(r),
      allergens: readRecipeStringList(r, "allergens"),
      ingredients: readRecipeStringList(r, "ingredients"),
    }))
      .filter((r) => fitsProfileHardRules(r, { dietType: profile.dietType, allergies: allergyLabels }, catalog))
      .map((r) => ({ id: r.id, name: r.name, ingredients: r.ingredients }));

    insights.push(
      ...detectRecipesMatchingAvailablePantry(
        recipeCandidates,
        pantryStock.map((p) => ({ id: p.id, name: p.name, ingredientId: p.ingredientId, remainingQuantity: p.remainingQuantity, unit: p.unit })),
        now,
        1,
        catalog,
      ),
    );
  }

  const dismissed = await prisma.dismissedInsight.findMany({ where: { profileId }, select: { insightKey: true } });
  const dismissedKeys = new Set(dismissed.map((d) => d.insightKey));

  return dedupeAndSortInsights(excludeDismissed(insights, dismissedKeys));
}
