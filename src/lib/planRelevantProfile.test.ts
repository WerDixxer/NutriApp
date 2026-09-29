import { describe, expect, it } from "vitest";
import { hasPlanRelevantChange, type PlanRelevantProfile } from "./planRelevantProfile";

const profile: PlanRelevantProfile = {
  age: 34,
  sex: "FEMALE",
  heightCm: 168,
  weightKg: 62,
  activityLevel: "MODERATE",
  goal: "MAINTAIN",
  goalRateKgPerWeek: 0.5,
  sportType: "STRENGTH",
  dietType: "VEGETARIAN",
  likedFoods: ["Skyr", "Haferflocken"],
  dislikedFoods: ["Paprika"],
  allergies: ["Erdnüsse", "Sesam"],
  trainingSessions: [
    { weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" },
    { weekday: 4, startTime: "07:00", durationMin: 45, sportType: "ENDURANCE" },
  ],
};

describe("hasPlanRelevantChange (R5E-3)", () => {
  it("meldet keine Änderung bei identischen Werten", () => {
    expect(hasPlanRelevantChange(profile, { ...profile })).toBe(false);
  });

  it.each([
    ["Alter", { age: 35 }],
    ["Geschlecht", { sex: "MALE" }],
    ["Größe", { heightCm: 170 }],
    ["Gewicht", { weightKg: 61.5 }],
    ["Aktivität", { activityLevel: "HIGH" }],
    ["Ziel", { goal: "LOSE_WEIGHT" }],
    ["Tempo", { goalRateKgPerWeek: 0.25 }],
    ["Sportart", { sportType: "ENDURANCE" }],
    ["Ernährungsform", { dietType: "VEGAN" }],
    ["neue Allergie", { allergies: ["Erdnüsse", "Sesam", "Milch"] }],
    ["entfernte Allergie", { allergies: ["Erdnüsse"] }],
    ["neue Abneigung", { dislikedFoods: ["Paprika", "Pilze"] }],
    ["andere Lieblinge", { likedFoods: ["Skyr"] }],
  ] satisfies [string, Partial<PlanRelevantProfile>][])("erkennt eine planrelevante Änderung: %s", (_label, change) => {
    expect(hasPlanRelevantChange(profile, { ...profile, ...change })).toBe(true);
  });

  it("ignoriert Reihenfolge, Groß-/Kleinschreibung und Dopplungen in Listen", () => {
    const reordered = {
      ...profile,
      likedFoods: ["haferflocken", "SKYR", "Skyr"],
      allergies: ["Sesam", "erdnüsse"],
    };
    expect(hasPlanRelevantChange(profile, reordered)).toBe(false);
  });

  it.each([
    ["andere Startzeit", { weekday: 1, startTime: "19:00", durationMin: 60, sportType: "STRENGTH" }],
    ["andere Dauer", { weekday: 1, startTime: "18:00", durationMin: 90, sportType: "STRENGTH" }],
    ["andere Sportart", { weekday: 1, startTime: "18:00", durationMin: 60, sportType: "TEAM_SPORT" }],
    ["anderer Wochentag", { weekday: 2, startTime: "18:00", durationMin: 60, sportType: "STRENGTH" }],
  ])("erkennt eine Trainingsänderung: %s", (_label, changedSession) => {
    const after = { ...profile, trainingSessions: [changedSession, profile.trainingSessions[1]] };
    expect(hasPlanRelevantChange(profile, after)).toBe(true);
  });

  it("erkennt neue und entfernte Trainingseinheiten", () => {
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: [profile.trainingSessions[0]] })).toBe(true);
    const added = [...profile.trainingSessions, { weekday: 6, startTime: "10:00", durationMin: 30, sportType: "MIXED" }];
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: added })).toBe(true);
  });

  it("ignoriert eine andere Reihenfolge von Einheiten an verschiedenen Wochentagen", () => {
    const reordered = { ...profile, trainingSessions: [profile.trainingSessions[1], profile.trainingSessions[0]] };
    expect(hasPlanRelevantChange(profile, reordered)).toBe(false);
  });

  it("betrachtet je Wochentag nur die erste Einheit - wie der Planer", () => {
    const secondOnMonday = { weekday: 1, startTime: "06:00", durationMin: 30, sportType: "MIXED" };
    // Eine zusätzliche zweite Montagseinheit ändert nichts am Plan, dieselben Einheiten vertauscht dagegen schon.
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: [...profile.trainingSessions, secondOnMonday] })).toBe(false);
    const withSecond = { ...profile, trainingSessions: [...profile.trainingSessions, secondOnMonday] };
    const swapped = { ...profile, trainingSessions: [secondOnMonday, ...profile.trainingSessions] };
    expect(hasPlanRelevantChange(withSecond, swapped)).toBe(true);
  });
});
