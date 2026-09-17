import { z } from "zod";

export const sexSchema = z.enum(["MALE", "FEMALE"]);
export const activityLevelSchema = z.enum(["SEDENTARY", "LIGHT", "MODERATE", "HIGH", "ATHLETE"]);
export const goalSchema = z.enum(["LOSE_WEIGHT", "MAINTAIN", "GAIN_MUSCLE", "GAIN_WEIGHT"]);
export const sportTypeSchema = z.enum(["ENDURANCE", "STRENGTH", "ATHLETIC", "TEAM_SPORT", "MIXED", "NONE"]);
export const dietTypeSchema = z.enum([
  "OMNIVORE",
  "VEGETARIAN",
  "VEGAN",
  "PESCETARIAN",
  "KETO",
  "LOW_CARB",
  "HALAL",
  "KOSHER",
  "PALEO",
]);

export const trainingSessionSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Uhrzeit muss im Format HH:mm sein."),
  durationMin: z.number().int().min(1).max(600),
  sportType: sportTypeSchema,
  intensity: z.number().int().min(1).max(5),
});

const tagListSchema = z.array(z.string().trim().min(1).max(60)).max(50);

export const profilePayloadSchema = z.object({
  age: z.number().int().min(10).max(120),
  sex: sexSchema,
  heightCm: z.number().min(50).max(300),
  weightKg: z.number().min(20).max(400),
  activityLevel: activityLevelSchema,
  goal: goalSchema,
  goalRateKgPerWeek: z.number().min(0).max(5),
  sportType: sportTypeSchema,
  dietType: dietTypeSchema,
  likedFoods: tagListSchema,
  dislikedFoods: tagListSchema,
  allergies: tagListSchema,
  priorities: tagListSchema,
  trainingSessions: z.array(trainingSessionSchema).max(30),
});

export type ProfilePayload = z.infer<typeof profilePayloadSchema>;
export type TrainingSessionPayload = z.infer<typeof trainingSessionSchema>;

export const trendTagsPayloadSchema = z.object({
  tags: tagListSchema,
});
