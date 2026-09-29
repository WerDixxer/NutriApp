/**
 * Rezept-Snapshot der Planeinträge (R5E, MealPlanItem und MealPlanMeal): Ein Plan hält fest, mit
 * welchem Namen und welchen Nährwerten ein Rezept geplant wurde - je Portion des Basisrezepts, wie
 * Recipe.kcal usw. Die geplante Menge steht allein in `portionMultiplier`; geplant ist Wert × Faktor.
 *
 * Zutaten und Zubereitung gehören nicht zum Snapshot, sie kommen weiterhin live aus dem Rezept.
 */

/** Die Rezeptwerte, die ein Planeintrag beim Planen speichert (Spaltennamen wie im Schema). */
export interface RecipeSnapshot {
  recipeName: string;
  recipeKcal: number;
  recipeProteinG: number;
  recipeCarbsG: number;
  recipeFatG: number;
}

/** Name und Nährwerte je Portion, wie sie Recipe, RecipeCandidate und SearchableRecipe tragen. */
export interface PlannableRecipe {
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/** Gespeicherte Snapshot-Spalten eines Planeintrags; bei Einträgen von vor R5E alle NULL. */
export type StoredRecipeSnapshot = { [Column in keyof RecipeSnapshot]?: RecipeSnapshot[Column] | null };

/** Snapshot-Spalten für einen neuen Planeintrag aus dem Rezept, das der Planer tatsächlich gewählt hat. */
export function recipeSnapshotOf(recipe: PlannableRecipe): RecipeSnapshot {
  return {
    recipeName: recipe.name,
    recipeKcal: recipe.kcal,
    recipeProteinG: recipe.proteinG,
    recipeCarbsG: recipe.carbsG,
    recipeFatG: recipe.fatG,
  };
}

/** Der gespeicherte Snapshot, sofern vollständig. Die Spalten werden immer gemeinsam geschrieben. */
function completeSnapshot(entry: StoredRecipeSnapshot): RecipeSnapshot | null {
  const { recipeName, recipeKcal, recipeProteinG, recipeCarbsG, recipeFatG } = entry;
  if (recipeName == null || recipeKcal == null || recipeProteinG == null || recipeCarbsG == null || recipeFatG == null) return null;
  return { recipeName, recipeKcal, recipeProteinG, recipeCarbsG, recipeFatG };
}

/**
 * Das Rezept eines Planeintrags, wie es geplant wurde: Name und Nährwerte aus dem Snapshot, alles
 * andere (Zutaten, Zubereitung, Bildstichwort, ...) aus dem aktuellen Rezept. Ohne vollständigen
 * Snapshot (Eintrag von vor R5E) gilt das aktuelle Rezept unverändert.
 */
export function recipeAsPlanned<Recipe extends PlannableRecipe>(entry: StoredRecipeSnapshot & { recipe: Recipe }): Recipe {
  const snapshot = completeSnapshot(entry);
  if (!snapshot) return entry.recipe;
  return {
    ...entry.recipe,
    name: snapshot.recipeName,
    kcal: snapshot.recipeKcal,
    proteinG: snapshot.recipeProteinG,
    carbsG: snapshot.recipeCarbsG,
    fatG: snapshot.recipeFatG,
  };
}
