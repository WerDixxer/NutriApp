import { z } from "zod";
import { calendarDateSchema } from "./calendarDate";

export const plannableMealSlotSchema = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK"]);

/**
 * `memberIds` werden hier nur auf Form geprüft (nicht-leere Strings) - ob sie
 * wirklich zum aktuellen Haushalt gehören, prüft der Service serverseitig
 * gegen die DB (siehe mealPlanner/generate.ts + api/meal-plans/generate/route.ts),
 * nie anhand der Eingabe selbst vertraut (Abschnitt 23).
 *
 * Bewusst OHNE calorieTarget/budget-Override (siehe Kapitel-10-Bericht):
 * ein Budget-Toggle hätte aktuell keinerlei echten Effekt (kein Preismodell
 * pro Rezept, siehe mealPlanner/softScoring.ts:scoreBudget), das UI/API dafür
 * zu bauen wäre eine vorgetäuschte Funktion ohne reale Wirkung.
 */
export const generateMealPlanSchema = z.object({
  /** Erster Kalendertag des Plans ("JJJJ-MM-TT", Nutzerzeit), kein Zeitpunkt. */
  startDate: calendarDateSchema,
  days: z.number().int().min(1, "Mindestens 1 Tag.").max(14, "Maximal 14 Tage."),
  mealTypes: z.array(plannableMealSlotSchema).min(1, "Mindestens ein Mahlzeiten-Typ.").max(4),
  memberIds: z.array(z.string().min(1)).max(20).optional(),
  name: z.string().trim().max(80).optional(),
});

export const updateMealPlanSchema = z.object({
  name: z.string().trim().max(80).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
});

export type GenerateMealPlanInput = z.infer<typeof generateMealPlanSchema>;
export type UpdateMealPlanInput = z.infer<typeof updateMealPlanSchema>;
