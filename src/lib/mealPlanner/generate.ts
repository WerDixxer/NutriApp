import { addDays, type CalendarDate } from "../calendarDate";
import { buildPlanningContext } from "./planningContext";
import { generateMealPlan } from "./plannerEngine";
import { validateGeneratedPlan } from "./validatePlan";
import { createMealPlan } from "./mealPlanService";
import type { MealPlanGenerationStatus, PlannableMealSlot, UnmetSlot } from "./types";

export interface GenerateMealPlanRequest {
  householdId: string;
  /** null = alle Mitglieder des Haushalts (Abschnitt 23: "Falls keine memberIds angegeben"). */
  householdMemberIds: string[] | null;
  /** Erster Kalendertag des Plans (Nutzerzeit). */
  startDate: CalendarDate;
  days: number;
  slots: PlannableMealSlot[];
  name?: string;
  maxCookingTimeMin?: number;
}

export interface GenerateMealPlanResult {
  status: MealPlanGenerationStatus;
  plan: Awaited<ReturnType<typeof createMealPlan>> | null;
  unmetSlots: UnmetSlot[];
  validationErrors: string[];
}

/**
 * Orchestriert den vollständigen Ablauf aus Abschnitt 17: Context laden ->
 * deterministisch planen -> validieren -> (nur bei bestandener Validierung)
 * speichern. SUCCESS/PARTIAL werden gespeichert (PARTIAL als DRAFT, damit
 * ein unvollständiger Plan nicht fälschlich als "aktiv" erscheint), bei
 * NO_VALID_PLAN wird NICHTS in der DB angelegt.
 */
export async function generateAndSaveMealPlan(request: GenerateMealPlanRequest, now: Date = new Date()): Promise<GenerateMealPlanResult> {
  const context = await buildPlanningContext(request.householdId, request.householdMemberIds, now);

  if (context.members.length === 0) {
    return { status: "NO_VALID_PLAN", plan: null, unmetSlots: [], validationErrors: ["Kein gültiges Haushaltsmitglied mit vollständigem Profil gefunden."] };
  }

  const planningInput = { startDate: request.startDate, days: request.days, slots: request.slots, maxCookingTimeMin: request.maxCookingTimeMin };
  const generated = generateMealPlan(context, planningInput, now);

  if (generated.status === "NO_VALID_PLAN") {
    return { status: "NO_VALID_PLAN", plan: null, unmetSlots: generated.unmetSlots, validationErrors: [] };
  }

  const validationErrors = validateGeneratedPlan(generated, context, planningInput);
  if (validationErrors.length > 0) {
    // Letzte Sicherheitsprüfung (Abschnitt 19): lieber nichts speichern als
    // einen Plan mit einem Hard-Constraint-Verstoß oder einem ungültigen Rezeptbezug.
    return {
      status: "NO_VALID_PLAN",
      plan: null,
      unmetSlots: generated.unmetSlots,
      validationErrors: validationErrors.map((e) => e.message),
    };
  }

  const plan = await createMealPlan(request.householdId, {
    name: request.name,
    startDate: request.startDate,
    endDate: addDays(request.startDate, request.days - 1),
    householdMemberIds: context.members.map((m) => m.householdMemberId),
    meals: generated.meals,
    status: generated.status === "SUCCESS" ? "ACTIVE" : "DRAFT",
  });

  return { status: generated.status, plan, unmetSlots: generated.unmetSlots, validationErrors: [] };
}
