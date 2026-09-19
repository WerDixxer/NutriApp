import { prisma } from "../db";
import { getMealPlan } from "../mealPlanner/mealPlanService";
import { getHouseholdRotation } from "../rotation/rotationService";
import { aggregateIngredients, type MealForAggregation } from "./aggregation";
import { enrichAggregatedIngredients, type PantryItemForMatch } from "./enrichment";
import { buildPrepGroups, buildSoloRecipes, type RecipeInfo } from "./batching";
import { computeMealPrepScore } from "./scoring";
import { buildSummary } from "./explain";
import { normalizeIngredientKey } from "./ingredientParser";
import type { KnownPrice } from "../budget/mealCost";
import type { MealPrepPlan, MealPrepStrategy, MealPrepWarning, MealRef } from "./types";

/**
 * Read-only Analyse eines BESTEHENDEN Meal Plans (Abschnitt 25: kein
 * automatisches Verändern des Plans, nur Analyse + Vorschlag). Household-
 * Isolation läuft ausschließlich über die bestehende, bereits getestete
 * `getMealPlan(householdId, id)` (Kapitel 10) - eine fremde/erratene
 * mealPlanId liefert konsequent `null`, nie Daten eines anderen Haushalts.
 */
export async function analyzeMealPrep(
  householdId: string,
  mealPlanId: string,
  strategy: MealPrepStrategy = "BALANCED",
  now: Date = new Date(),
): Promise<MealPrepPlan | null> {
  const plan = await getMealPlan(householdId, mealPlanId);
  if (!plan) return null;

  const meals: MealForAggregation[] = plan.meals.map((m) => ({
    id: m.id,
    date: m.date,
    slot: m.slot,
    recipeId: m.recipeId,
    recipeName: m.recipe.name,
    ingredients: JSON.parse(m.recipe.ingredients) as string[],
    portionMultiplier: m.portionMultiplier,
  }));

  const { aggregated, unparsed } = aggregateIngredients(meals);

  const [pantryItems, rotation, foodPrices] = await Promise.all([
    prisma.pantryItem.findMany({ where: { householdId }, select: { id: true, name: true, remainingQuantity: true, unit: true } }),
    getHouseholdRotation(householdId, now),
    prisma.foodPrice.findMany({ where: { householdId }, select: { name: true, priceCents: true, quantity: true, unit: true } }),
  ]);

  const urgencyByItemId = new Map(rotation.results.map((r) => [r.pantryItemId, r.urgency]));
  const priceByKey = new Map<string, KnownPrice>(
    foodPrices.map((p) => [normalizeIngredientKey(p.name), { priceCents: p.priceCents, quantity: p.quantity, unit: p.unit }]),
  );

  const enriched = enrichAggregatedIngredients(aggregated, pantryItems as PantryItemForMatch[], urgencyByItemId, priceByKey);

  const batchable = enriched.filter((i) => i.recipeCount >= 2);
  const { prepGroups } = buildPrepGroups(batchable, strategy);

  const prepTimeByRecipeId = new Map(plan.meals.map((m) => [m.recipeId, m.recipe.prepTimeMin]));
  for (const group of prepGroups) {
    group.combinedPrepTimeMin = group.sourceRecipeIds.reduce((sum, recipeId) => sum + (prepTimeByRecipeId.get(recipeId) ?? 0), 0);
  }

  const distinctRecipes = buildDistinctRecipes(meals);
  const soloRecipes = buildSoloRecipes(distinctRecipes, prepGroups);

  const baselineCookingSessions = distinctRecipes.length;
  const totalCookingSessions = prepGroups.length + soloRecipes.length;

  const { score, breakdown } = computeMealPrepScore(
    enriched,
    prepGroups,
    baselineCookingSessions,
    totalCookingSessions,
    distinctRecipes.length,
    plan.startDate,
    plan.endDate,
  );

  const summary = buildSummary(baselineCookingSessions, totalCookingSessions, prepGroups, soloRecipes, enriched);

  const warnings: MealPrepWarning[] = [];
  if (unparsed.length > 0) {
    warnings.push({
      code: "INGREDIENT_STRUCTURE_INCOMPLETE",
      message: `${unparsed.length} Zutatenzeile(n) konnten nicht strukturiert erkannt werden und fließen nicht in die Mengenberechnung ein.`,
    });
  }
  if (enriched.length > 0 && enriched.every((i) => i.costCents === null)) {
    warnings.push({ code: "NO_PRICE_DATA", message: "Keine Preisdaten vorhanden. Der Budget-Faktor bleibt neutral." });
  }
  if (pantryItems.length === 0) {
    warnings.push({ code: "NO_PANTRY_DATA", message: "Keine Vorräte erfasst. Der Pantry-Faktor bleibt neutral." });
  }

  return {
    mealPlanId,
    strategy,
    baselineCookingSessions,
    totalCookingSessions,
    prepGroups,
    soloRecipes,
    unparsedIngredients: unparsed,
    warnings,
    optimizationScore: score,
    scoreBreakdown: breakdown,
    summary,
  };
}

function buildDistinctRecipes(meals: MealForAggregation[]): RecipeInfo[] {
  const byRecipe = new Map<string, RecipeInfo>();
  for (const meal of meals) {
    const mealRef: MealRef = { mealId: meal.id, date: meal.date, slot: meal.slot };
    const existing = byRecipe.get(meal.recipeId);
    if (existing) existing.meals.push(mealRef);
    else byRecipe.set(meal.recipeId, { recipeId: meal.recipeId, recipeName: meal.recipeName, meals: [mealRef] });
  }
  return Array.from(byRecipe.values());
}
