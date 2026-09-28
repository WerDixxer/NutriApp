import { z } from "zod";
import { RECIPE_UNITS } from "../recipes/types";
import { dietTypeSchema } from "./profile";
import { mealSlotSchema } from "./recipes";

/**
 * Formen der als JSON-Text gespeicherten Datenbankspalten (schema.prisma), zum Lesen über
 * `readJsonColumn` (jsonColumn.ts). Bewusst nur die Form, die der Code tatsächlich voraussetzt -
 * keine Längen- oder Inhaltsregeln der Eingabe-Schemas, damit ältere, damals gültige Datensätze
 * lesbar bleiben. Enums nutzen dieselben Schemas wie die Eingabevalidierung.
 */

/** JSON-Array aus Strings, z.B. `Recipe.ingredients`, `Recipe.tags`, `MealPlanMeal.reasons`. */
export const storedStringListSchema = z.array(z.string());

/** `Recipe.mealSlots`: JSON-Array von MealSlot-Werten. */
export const storedMealSlotListSchema = z.array(mealSlotSchema);

/** `Recipe.dietTypes`: JSON-Array von DietType-Werten. */
export const storedDietTypeListSchema = z.array(dietTypeSchema);

/**
 * `Ingredient.unitGrams`: Gramm je Einheit, z.B. `{"ml":1.03,"piece":55}`. Unbekannte Schlüssel
 * bleiben erhalten (looseObject) - gelesen werden ohnehin nur die bekannten Einheiten.
 */
export const storedUnitGramsSchema = z.looseObject({
  ml: z.number().optional(),
  piece: z.number().optional(),
  slice: z.number().optional(),
  tl: z.number().optional(),
  el: z.number().optional(),
  can: z.number().optional(),
});

/**
 * Ein Element von `RecipeImportCandidate.ingredients` (StoredImportIngredient, importWorkflow.ts).
 * looseObject: zusätzliche Felder bleiben erhalten, weil die Spalte beim Food-Zuordnen gelesen und
 * wieder geschrieben wird - ein stilles Entfernen wäre eine Datenänderung.
 */
export const storedImportIngredientSchema = z.looseObject({
  originalText: z.string(),
  normalizedLabel: z.string(),
  amount: z.number().nullable(),
  unit: z.enum(RECIPE_UNITS).nullable(),
  optional: z.boolean(),
  resolutionStatus: z.enum(["resolved", "unresolved"]),
  resolvedFoodId: z.string().nullable(),
  resolvedFoodName: z.string().nullable(),
  manualAssignment: z.looseObject({ assignedAt: z.string(), actorUserId: z.string().nullable() }).nullable(),
});

export const storedImportIngredientListSchema = z.array(storedImportIngredientSchema);

/** Frei strukturierte JSON-Spalten (z.B. `rawPayload`, Audit-`details`): nur die Syntax wird geprüft. */
export const storedAnyJsonSchema = z.unknown();
