import type { MacroTarget } from "../nutrition";
import type { PlannableMealSlot, SlotTarget } from "./types";

/**
 * Bewusst EINFACHER als planner.ts:buildDayPlan() (5 Slots inkl. Pre-/Post-
 * Workout, pro-Makro-differenzierte Gewichte, trainingszeitabhängig): der
 * Haushalts-Planer deckt nur die in Kapitel 10 Abschnitt 3 verlangten Slots ab
 * (BREAKFAST/LUNCH/DINNER, optional SNACK) für MEHRERE Personen mit
 * potenziell unterschiedlichen Trainingszeiten - eine einzelne trainings-
 * bewusste Verschiebung würde für die anderen Mitglieder falsch sein. Ein
 * einziger kcal-Anteil pro Slot, gleich auf alle vier Makros angewendet,
 * ist hier die ehrliche, nicht erfundene Vereinfachung ("keine komplizierten
 * Meal-Slots erfinden", Abschnitt 3).
 */
const SLOT_WEIGHTS_WITHOUT_SNACK: Record<"BREAKFAST" | "LUNCH" | "DINNER", number> = {
  BREAKFAST: 0.25,
  LUNCH: 0.35,
  DINNER: 0.4,
};

const SLOT_WEIGHTS_WITH_SNACK: Record<PlannableMealSlot, number> = {
  BREAKFAST: 0.22,
  LUNCH: 0.32,
  SNACK: 0.13,
  DINNER: 0.33,
};

export function buildSlotTargets(dailyTarget: MacroTarget, slots: PlannableMealSlot[]): SlotTarget[] {
  const hasSnack = slots.includes("SNACK");
  const weights = hasSnack ? SLOT_WEIGHTS_WITH_SNACK : SLOT_WEIGHTS_WITHOUT_SNACK;
  // Normalisiert auf die tatsächlich angeforderten Slots (falls z.B. nur BREAKFAST+DINNER verlangt sind).
  const totalWeight = slots.reduce((sum, s) => sum + (weights[s as keyof typeof weights] ?? 0), 0) || 1;

  return slots.map((slot) => {
    const w = (weights[slot as keyof typeof weights] ?? 0) / totalWeight;
    return {
      slot,
      kcal: Math.round(dailyTarget.kcal * w),
      proteinG: Math.round(dailyTarget.proteinG * w),
      carbsG: Math.round(dailyTarget.carbsG * w),
      fatG: Math.round(dailyTarget.fatG * w),
    };
  });
}
