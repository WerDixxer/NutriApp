import { describe, expect, it } from "vitest";
import { profilePayloadSchema, trendTagsPayloadSchema } from "./profile";
import { recipePayloadSchema } from "./recipes";
import { logPayloadSchema } from "./log";
import { assistantMessageSchema } from "./assistant";
import { firstZodIssue } from "./zodError";

const validProfile = {
  age: 28,
  sex: "MALE",
  heightCm: 180,
  weightKg: 78,
  activityLevel: "MODERATE",
  goal: "MAINTAIN",
  goalRateKgPerWeek: 0,
  sportType: "MIXED",
  dietType: "OMNIVORE",
  likedFoods: [],
  dislikedFoods: [],
  allergies: [],
  priorities: [],
  trainingSessions: [],
};

describe("profilePayloadSchema", () => {
  it("accepts a valid payload", () => {
    expect(profilePayloadSchema.safeParse(validProfile).success).toBe(true);
  });

  it("rejects an invalid enum value", () => {
    const result = profilePayloadSchema.safeParse({ ...validProfile, sex: "OTHER" });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-range age", () => {
    const result = profilePayloadSchema.safeParse({ ...validProfile, age: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed training session start time", () => {
    const result = profilePayloadSchema.safeParse({
      ...validProfile,
      trainingSessions: [{ weekday: 0, startTime: "18h00", durationMin: 60, sportType: "MIXED", intensity: 3 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("trendTagsPayloadSchema", () => {
  it("accepts an empty tag list", () => {
    expect(trendTagsPayloadSchema.safeParse({ tags: [] }).success).toBe(true);
  });
});

describe("recipePayloadSchema", () => {
  const validRecipe = {
    name: "Testgericht",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 20,
    servings: 1,
    mealSlots: ["LUNCH"],
    dietTypes: ["OMNIVORE"],
    allergens: [],
    ingredients: ["200 g Reis"],
    instructions: ["Kochen."],
  };

  it("accepts a valid recipe and fills defaults", () => {
    const result = recipePayloadSchema.safeParse(validRecipe);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("");
      expect(result.data.tags).toEqual([]);
    }
  });

  it("rejects an empty mealSlots array", () => {
    expect(recipePayloadSchema.safeParse({ ...validRecipe, mealSlots: [] }).success).toBe(false);
  });

  it("rejects an empty ingredients array", () => {
    expect(recipePayloadSchema.safeParse({ ...validRecipe, ingredients: [] }).success).toBe(false);
  });
});

describe("logPayloadSchema", () => {
  it("accepts a minimal valid entry", () => {
    const result = logPayloadSchema.safeParse({
      date: "2026-09-17",
      slot: "LUNCH",
      kcal: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 15,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid slot", () => {
    const result = logPayloadSchema.safeParse({
      date: "2026-09-17",
      slot: "BRUNCH",
      kcal: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 15,
    });
    expect(result.success).toBe(false);
  });
});

describe("assistantMessageSchema", () => {
  it("rejects an empty message", () => {
    expect(assistantMessageSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("trims the message", () => {
    const result = assistantMessageSchema.safeParse({ message: "  Hallo  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.message).toBe("Hallo");
  });
});

describe("firstZodIssue", () => {
  it("prefixes the message with the field path", () => {
    const result = logPayloadSchema.safeParse({
      date: "2026-09-17",
      slot: "BRUNCH",
      kcal: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 15,
    });
    if (!result.success) {
      expect(firstZodIssue(result.error)).toContain("slot");
    }
  });
});
