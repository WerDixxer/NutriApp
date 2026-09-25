import { addDays, type CalendarDate } from "../calendarDate";
import { checkHouseholdHardConstraints } from "./hardConstraints";
import type { GeneratedMeal, GeneratedMealPlan, PlannableMealSlot, PlanningContext } from "./types";

export interface PlanValidationError {
  meal: GeneratedMeal;
  message: string;
}

/**
 * Letzte Sicherheitsprüfung VOR dem Speichern (Abschnitt 19): existiert das
 * Rezept wirklich, verletzt es (erneut) keine Hard Constraints, liegen
 * Datum/Slot/Portion im gültigen Rahmen, gehört jedes geplante Mitglied
 * wirklich zum Haushalt. Ein Plan mit auch nur einem Fehler hier darf NICHT
 * gespeichert werden - der Aufrufer (mealPlanService.ts) prüft das Ergebnis.
 */
export function validateGeneratedPlan(
  plan: GeneratedMealPlan,
  context: PlanningContext,
  input: { startDate: CalendarDate; days: number; slots: PlannableMealSlot[] },
): PlanValidationError[] {
  const errors: PlanValidationError[] = [];
  const candidateById = new Map(context.candidates.map((c) => [c.id, c]));

  // Kalendertage "JJJJ-MM-TT" lassen sich direkt als Text vergleichen.
  const firstDay = input.startDate;
  const lastDay = addDays(input.startDate, input.days - 1);

  if (context.members.length === 0) {
    errors.push({
      meal: { date: input.startDate, slot: input.slots[0] ?? "BREAKFAST", recipeId: "", recipeName: "", portionMultiplier: 0, reasons: [] },
      message: "Kein gültiges Haushaltsmitglied für diesen Plan.",
    });
  }

  for (const meal of plan.meals) {
    const recipe = candidateById.get(meal.recipeId);
    if (!recipe) {
      errors.push({ meal, message: "Rezept existiert nicht (mehr) in der Datenbank." });
      continue;
    }
    if (!Number.isFinite(meal.portionMultiplier) || meal.portionMultiplier <= 0) {
      errors.push({ meal, message: "Ungültige Portionsgröße." });
    }
    if (meal.date < firstDay || meal.date > lastDay) {
      errors.push({ meal, message: "Datum liegt außerhalb des Planungszeitraums." });
    }
    if (!input.slots.includes(meal.slot)) {
      errors.push({ meal, message: "Mahlzeiten-Slot wurde nicht angefordert." });
    }
    const violations = checkHouseholdHardConstraints(recipe, context.members, context.excludedIngredients, context.foodPreferences?.catalog);
    if (violations.length > 0) {
      errors.push({ meal, message: `Verletzt Hard Constraints: ${violations.map((v) => v.detail).join(" ")}` });
    }
  }

  return errors;
}
