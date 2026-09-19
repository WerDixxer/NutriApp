import { z } from "zod";

export const mealPrepQuerySchema = z.object({
  strategy: z.enum(["MIN_COOKING", "BALANCED", "FRESHNESS"]).default("BALANCED"),
});

export type MealPrepQueryInput = z.infer<typeof mealPrepQuerySchema>;
