import { z } from "zod";
import { calendarDateSchema } from "./calendarDate";
import { mealSlotSchema } from "./recipes";

export const logPayloadSchema = z.object({
  /** Kalendertag des Eintrags ("JJJJ-MM-TT"), kein Zeitpunkt. */
  date: calendarDateSchema,
  slot: mealSlotSchema,
  recipeId: z.string().min(1).optional(),
  customName: z.string().trim().max(120).optional(),
  kcal: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(500),
});

export type LogPayload = z.infer<typeof logPayloadSchema>;
