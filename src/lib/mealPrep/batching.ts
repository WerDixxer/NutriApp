import type { AggregatedIngredient, MealPrepStrategy, MealRef, PrepGroup, PrepTask, SoloRecipe } from "./types";

interface RecipeInfo {
  recipeId: string;
  recipeName: string;
  meals: MealRef[];
}

/**
 * Welche Zutaten wirklich gemeinsam vorbereitet werden KÖNNEN, ist unabhängig
 * von der Strategie ein struktureller Fakt (von >=2 verschiedenen Rezepten
 * benötigt, siehe Abschnitt 7). Was sich je Strategie unterscheidet, ist wie
 * diese batchbaren Zutaten zu konkreten Koch-/Vorbereitungs-SITZUNGEN
 * gruppiert werden - jede Variante ist real unterschiedlich, keine reine
 * Kosmetik:
 *
 * - MIN_COOKING: alle batchbaren Zutaten in EINER Sitzung -> absolutes Minimum an Kochvorgängen.
 * - FRESHNESS: nach frühestem Bedarfsdatum in zwei Sitzungen (früh/spät) gesplittet,
 *   damit nicht alles am ersten Tag für Mahlzeiten Tage später vorbereitet wird -
 *   eine Ablaufdatum-/Haltbarkeits-BEHAUPTUNG wird dabei nie gemacht (Abschnitt 12).
 * - BALANCED: Zutaten, die dasselbe Rezept teilen, clustern natürlich zusammen
 *   (Connected Components über gemeinsame Rezepte) - weder maximal aggressiv
 *   noch künstlich aufgesplittet.
 */
export function buildPrepGroups(
  batchable: AggregatedIngredient[],
  strategy: MealPrepStrategy,
): { prepGroups: PrepGroup[] } {
  if (batchable.length === 0) return { prepGroups: [] };

  if (strategy === "MIN_COOKING") {
    return { prepGroups: [buildGroup("prep-1", "Batch-Vorbereitung", batchable)] };
  }

  if (strategy === "FRESHNESS") {
    const sorted = [...batchable].sort((a, b) => earliestDate(a).getTime() - earliestDate(b).getTime());
    const mid = Math.ceil(sorted.length / 2);
    const early = sorted.slice(0, mid);
    const late = sorted.slice(mid);
    const groups = [buildGroup("prep-1", "Früh in der Woche", early)];
    if (late.length > 0) groups.push(buildGroup("prep-2", "Später in der Woche", late));
    return { prepGroups: groups };
  }

  // BALANCED: Connected Components über gemeinsam genutzte Rezepte (Union-Find).
  const parent = new Map<string, string>();
  function find(x: string): string {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (const ingredient of batchable) find(ingredient.key);
  for (let i = 0; i < batchable.length; i++) {
    for (let j = i + 1; j < batchable.length; j++) {
      const recipesA = new Set(batchable[i].sourceMeals.map((m) => m.recipeId));
      const recipesB = new Set(batchable[j].sourceMeals.map((m) => m.recipeId));
      const sharesRecipe = [...recipesA].some((r) => recipesB.has(r));
      if (sharesRecipe) union(batchable[i].key, batchable[j].key);
    }
  }

  const clusters = new Map<string, AggregatedIngredient[]>();
  for (const ingredient of batchable) {
    const root = find(ingredient.key);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(ingredient);
  }

  const prepGroups = Array.from(clusters.values())
    .sort((a, b) => earliestDate(a[0]).getTime() - earliestDate(b[0]).getTime())
    .map((ingredients, i) => buildGroup(`prep-${i + 1}`, groupName(ingredients), ingredients));

  return { prepGroups };
}

function earliestDate(ingredient: AggregatedIngredient): Date {
  return ingredient.sourceMeals.reduce((min, m) => (m.date < min ? m.date : min), ingredient.sourceMeals[0].date);
}

function groupName(ingredients: AggregatedIngredient[]): string {
  if (ingredients.length === 1) return ingredients[0].displayName;
  return `Batch: ${ingredients.map((i) => i.displayName).join(" + ")}`;
}

function buildGroup(id: string, name: string, ingredients: AggregatedIngredient[]): PrepGroup {
  const tasks: PrepTask[] = ingredients.map((ing) => ({
    ingredientKey: ing.key,
    displayName: ing.displayName,
    totalQuantity: ing.totalQuantity,
    unit: ing.unit,
    usedForMeals: ing.sourceMeals,
    pantry: ing.pantry,
  }));

  const allDates = ingredients.flatMap((ing) => ing.sourceMeals.map((m) => m.date));
  const recipeIds = Array.from(new Set(ingredients.flatMap((ing) => ing.sourceMeals.map((m) => m.recipeId))));

  return {
    id,
    name,
    tasks,
    sourceRecipeIds: recipeIds,
    earliestNeededDate: new Date(Math.min(...allDates.map((d) => d.getTime()))),
    latestNeededDate: new Date(Math.max(...allDates.map((d) => d.getTime()))),
    combinedPrepTimeMin: 0, // von prepTime.ts anhand der tatsächlich beteiligten Rezepte gesetzt (siehe mealPrepService.ts)
  };
}

/** Rezepte, die kein von >=2 Rezepten geteiltes Zutaten-Batching haben, bleiben eigenständige Kochvorgänge. */
export function buildSoloRecipes(distinctRecipes: RecipeInfo[], prepGroups: PrepGroup[]): SoloRecipe[] {
  const batchedRecipeIds = new Set(prepGroups.flatMap((g) => g.sourceRecipeIds));
  return distinctRecipes
    .filter((r) => !batchedRecipeIds.has(r.recipeId))
    .map((r) => ({ recipeId: r.recipeId, recipeName: r.recipeName, meals: r.meals }));
}

export type { RecipeInfo };
