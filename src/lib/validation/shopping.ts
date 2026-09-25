import { z } from "zod";
import { calendarDateSchema } from "./calendarDate";

/**
 * `date` (JJJJ-MM-TT) ist ein beliebiger Kalendertag der gewünschten Woche; ohne Angabe
 * gilt die aktuelle Woche des Nutzers (siehe src/lib/calendarDate.ts).
 */
export const weeklyShoppingQuerySchema = z.object({
  date: calendarDateSchema.optional(),
});

export type WeeklyShoppingQueryInput = z.infer<typeof weeklyShoppingQuerySchema>;
