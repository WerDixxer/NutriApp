import { readJsonColumn } from "../validation/jsonColumn";
import {
  storedDietTypeListSchema,
  storedMealSlotListSchema,
  storedStringListSchema,
} from "../validation/jsonColumnSchemas";

/**
 * Geprüftes Lesen der JSON-Spalten von `Recipe` (statt `JSON.parse(recipe.x) as T`, R5D).
 * Jede Funktion wirft `JsonColumnError` mit Recipe-ID und Spalte, wenn der gespeicherte Wert
 * kein gültiges JSON ist oder nicht die erwartete Form hat.
 */

export type RecipeStringListColumn = "allergens" | "ingredients" | "instructions" | "tags";

/** `allergens`, `ingredients`, `instructions` oder `tags` als `string[]`. */
export function readRecipeStringList<C extends RecipeStringListColumn>(recipe: { id: string } & Record<C, string>, column: C) {
  return readJsonColumn({ model: "Recipe", id: recipe.id, column }, recipe[column], storedStringListSchema);
}

/** `mealSlots` als Liste gültiger MealSlot-Werte. */
export function readRecipeMealSlots(recipe: { id: string; mealSlots: string }) {
  return readJsonColumn({ model: "Recipe", id: recipe.id, column: "mealSlots" }, recipe.mealSlots, storedMealSlotListSchema);
}

/** `dietTypes` als Liste gültiger DietType-Werte. */
export function readRecipeDietTypes(recipe: { id: string; dietTypes: string }) {
  return readJsonColumn({ model: "Recipe", id: recipe.id, column: "dietTypes" }, recipe.dietTypes, storedDietTypeListSchema);
}
