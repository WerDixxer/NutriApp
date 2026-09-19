import { z } from "zod";

/**
 * `date` (YYYY-MM-DD) ist ein beliebiger Tag der gewünschten Woche; ohne Angabe
 * gilt die aktuelle Woche. Als LOKALES Datum gelesen (nicht `new Date("2026-09-21")`,
 * das wäre UTC-Mitternacht), passend zu den lokal gespeicherten MealPlanDay-Daten.
 */
export const weeklyShoppingQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Datum muss das Format JJJJ-MM-TT haben.")
    .transform((value) => {
      const [year, month, day] = value.split("-").map(Number);
      return { value, date: new Date(year, month - 1, day) };
    })
    .refine(({ value, date }) => {
      const [year, month, day] = value.split("-").map(Number);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
    }, "Ungültiges Datum.")
    .transform(({ date }) => date)
    .optional(),
});

export type WeeklyShoppingQueryInput = z.infer<typeof weeklyShoppingQuerySchema>;
