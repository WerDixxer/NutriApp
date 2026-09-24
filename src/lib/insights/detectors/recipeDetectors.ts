import { aggregateIngredients, type MealForAggregation } from "../../mealPrep/aggregation";
import { enrichAggregatedIngredients, type PantryItemForMatch } from "../../mealPrep/enrichment";
import type { FoodCatalog } from "../../recipes/catalog";
import type { Insight } from "../types";

export interface RecipeInsightCandidate {
  id: string;
  name: string;
  ingredients: string[];
}

/**
 * Welche(s) Rezept(e) aus einer bereits vorgefilterten Kandidatenliste (Diät/
 * Allergie-kompatibel, siehe generateMealPlan.ts - diese Vorfilterung wird
 * hier NICHT dupliziert, sondern vom Aufrufer erwartet) sich JETZT
 * vollständig aus dem Vorrat kochen lassen. Nur Rezepte mit mindestens einer
 * strukturiert erkannten Zutatenzeile zählen (siehe ingredientParser.ts) -
 * ein Rezept ohne auswertbare Zutaten liefert bewusst kein Ergebnis statt
 * eines geratenen.
 *
 * Bewusst auf `limit` begrenzt (Default 1): ein einzelner, konkreter Treffer
 * wirkt wie eine gezielte Beobachtung, eine lange Liste wie eine generische
 * Rezeptsuche - genau das soll dieses Insight nicht sein.
 */
export function detectRecipesMatchingAvailablePantry(
  candidates: RecipeInsightCandidate[],
  pantryItems: PantryItemForMatch[],
  now: Date = new Date(),
  limit = 1,
  catalog?: FoodCatalog,
): Insight[] {
  const matches: { recipeId: string; recipeName: string; ingredientCount: number }[] = [];

  for (const recipe of candidates) {
    const meal: MealForAggregation = {
      id: recipe.id,
      date: now,
      slot: "DINNER",
      recipeId: recipe.id,
      recipeName: recipe.name,
      ingredients: recipe.ingredients,
      portionMultiplier: 1,
    };
    const { aggregated, unparsed } = aggregateIngredients([meal]);
    if (aggregated.length === 0 || unparsed.length > 0) continue;

    const enriched = enrichAggregatedIngredients(aggregated, pantryItems, new Map(), new Map(), catalog);
    const fullyCovered = enriched.every((i) => i.pantry && i.pantry.availableQuantity >= i.totalQuantity);
    if (fullyCovered) matches.push({ recipeId: recipe.id, recipeName: recipe.name, ingredientCount: aggregated.length });
  }

  // Deterministisch: mehr Zutaten zuerst (das "substanziellere" Rezept),
  // bei Gleichstand nach recipeId - nie von der Eingabe-Reihenfolge abhängig.
  matches.sort((a, b) => b.ingredientCount - a.ingredientCount || a.recipeId.localeCompare(b.recipeId));

  return matches.slice(0, limit).map((m) => ({
    id: `recipe:available:${m.recipeId}`,
    type: "RECIPE_MATCHES_AVAILABLE_PANTRY",
    category: "RECIPE",
    priority: "useful",
    message: `Du hast schon alles da, um ${m.recipeName} zu kochen.`,
    context: { recipeId: m.recipeId, recipeName: m.recipeName, ingredientCount: m.ingredientCount },
    source: { entity: "Recipe", id: m.recipeId },
    surfaces: ["DASHBOARD"],
    detectedAt: now,
    expiresAt: null,
  }));
}
