import { z } from "zod";
import { dietTypeSchema } from "./profile";

export const mealSlotSchema = z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "PRE_WORKOUT", "POST_WORKOUT"]);

const stringListSchema = z.array(z.string().trim().min(1).max(200));

export const recipePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().default(""),
  kcal: z.number().min(0).max(5000),
  proteinG: z.number().min(0).max(500),
  carbsG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(500),
  prepTimeMin: z.number().int().min(1).max(600),
  servings: z.number().int().min(1).max(50),
  mealSlots: z.array(mealSlotSchema).min(1),
  dietTypes: z.array(dietTypeSchema).min(1),
  allergens: stringListSchema.max(20).default([]),
  tags: stringListSchema.max(20).optional().default([]),
  ingredients: stringListSchema.min(1).max(50),
  instructions: stringListSchema.min(1).max(50),
});

export type RecipePayload = z.infer<typeof recipePayloadSchema>;
