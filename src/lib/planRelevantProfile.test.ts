import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  COMPARED_PLAN_RELEVANT_FIELDS,
  PLAN_RELEVANT_PROFILE_SELECT,
  hasPlanRelevantChange,
  type PlanRelevantProfile,
} from "./planRelevantProfile";

type Session = PlanRelevantProfile["trainingSessions"][number];

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
  ] satisfies [string, Session][])("erkennt eine Trainingsänderung: %s", (_label, changedSession) => {
    const after = { ...profile, trainingSessions: [changedSession, profile.trainingSessions[1]] };
    expect(hasPlanRelevantChange(profile, after)).toBe(true);
  });

  it("erkennt neue und entfernte Trainingseinheiten", () => {
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: [profile.trainingSessions[0]] })).toBe(true);
    const added: Session[] = [...profile.trainingSessions, { weekday: 6, startTime: "10:00", durationMin: 30, sportType: "MIXED" }];
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: added })).toBe(true);
  });

  it("ignoriert eine andere Reihenfolge von Einheiten an verschiedenen Wochentagen", () => {
    const reordered = { ...profile, trainingSessions: [profile.trainingSessions[1], profile.trainingSessions[0]] };
    expect(hasPlanRelevantChange(profile, reordered)).toBe(false);
  });

  it("betrachtet je Wochentag nur die erste Einheit - wie der Planer", () => {
    const secondOnMonday: Session = { weekday: 1, startTime: "06:00", durationMin: 30, sportType: "MIXED" };
    // Eine zusätzliche zweite Montagseinheit ändert nichts am Plan, dieselben Einheiten vertauscht dagegen schon.
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: [...profile.trainingSessions, secondOnMonday] })).toBe(false);
    const withSecond = { ...profile, trainingSessions: [...profile.trainingSessions, secondOnMonday] };
    const swapped = { ...profile, trainingSessions: [secondOnMonday, ...profile.trainingSessions] };
    expect(hasPlanRelevantChange(withSecond, swapped)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R5F-10: Kopplung zwischen Schema, Planer-Sicht und Vergleich
// ---------------------------------------------------------------------------

/** Kennzeichen für Felder, die der Planer liest (dann gehören sie in PLAN_RELEVANT_PROFILE_SELECT). */
const PLAN_RELEVANT = "planrelevant";

/**
 * Jedes Feld von `Profile` (schema.prisma), bewusst eingeordnet: planrelevant oder mit Grund nicht.
 * Kommt ein Feld hinzu, schlägt der Test fehl, bis es hier eingeordnet ist - und ist es planrelevant,
 * muss es in die Planer-Sicht und damit in den Vergleich.
 */
const PROFILE_FIELDS: Record<string, string> = {
  id: "Schlüssel: Teil der Planer-Sicht nur für die eigenen Rezepte im Kandidatenpool, kein verglichener Wert",
  user: "Konto, kein Profilwert",
  userId: "Konto, kein Profilwert",
  createdAt: "Zeitstempel",
  updatedAt: "Zeitstempel",
  age: PLAN_RELEVANT,
  sex: PLAN_RELEVANT,
  heightCm: PLAN_RELEVANT,
  weightKg: PLAN_RELEVANT,
  activityLevel: PLAN_RELEVANT,
  goal: PLAN_RELEVANT,
  goalRateKgPerWeek: PLAN_RELEVANT,
  sportType: PLAN_RELEVANT,
  dietType: PLAN_RELEVANT,
  likedFoods: PLAN_RELEVANT,
  dislikedFoods: PLAN_RELEVANT,
  allergies: PLAN_RELEVANT,
  priorities: "vom Planer nicht gelesen",
  subscribedTrendTags: "vom Planer nicht gelesen (Trends zählen über Recipe.isTrending)",
  trainingSessions: PLAN_RELEVANT,
  logEntries: "Verzehr, kein Profilwert",
  mealPlanDays: "die Pläne selbst",
  customRecipes: "eigene Rezepte: Teil des Kandidatenpools, ihre Änderung löst bewusst keine Anpassung aus (R5E)",
  assistantMessages: "Assistant-Verlauf",
  dismissedInsights: "Insights",
};

/** Jedes Feld von `TrainingSession`, ebenso eingeordnet (planrelevant = in der Trainings-Auswahl der Planer-Sicht). */
const TRAINING_SESSION_FIELDS: Record<string, string> = {
  id: "Schlüssel",
  profile: "Zuordnung",
  profileId: "Zuordnung",
  weekday: PLAN_RELEVANT,
  startTime: PLAN_RELEVANT,
  durationMin: PLAN_RELEVANT,
  sportType: PLAN_RELEVANT,
  intensity: "vom Planer nicht gelesen",
};

function schemaFields(model: string): string[] {
  const found = Prisma.dmmf.datamodel.models.find((m) => m.name === model);
  if (!found) throw new Error(`Modell ${model} fehlt im Prisma-Schema`);
  return found.fields.map((field) => field.name).sort();
}

function planRelevant(classification: Record<string, string>): string[] {
  return Object.keys(classification)
    .filter((field) => classification[field] === PLAN_RELEVANT)
    .sort();
}

const VIEW_FIELDS = Object.keys(PLAN_RELEVANT_PROFILE_SELECT).sort();
const VIEW_TRAINING_FIELDS = Object.keys(PLAN_RELEVANT_PROFILE_SELECT.trainingSessions.select).sort();
const COMPARED_VIEW_FIELDS = VIEW_FIELDS.filter((field) => field !== "id");

describe("Planer-Sicht und Schema (R5F-10)", () => {
  it("jedes Feld von Profile ist bewusst als planrelevant oder nicht planrelevant eingeordnet", () => {
    expect(Object.keys(PROFILE_FIELDS).sort()).toEqual(schemaFields("Profile"));
  });

  it("jedes Feld von TrainingSession ist bewusst eingeordnet", () => {
    expect(Object.keys(TRAINING_SESSION_FIELDS).sort()).toEqual(schemaFields("TrainingSession"));
  });

  it("die Planer-Sicht enthält genau die planrelevanten Profilfelder (plus id für die eigenen Rezepte)", () => {
    expect(COMPARED_VIEW_FIELDS).toEqual(planRelevant(PROFILE_FIELDS));
    expect(VIEW_FIELDS).toContain("id");
  });

  it("die Trainings-Auswahl enthält genau die planrelevanten TrainingSession-Felder", () => {
    expect(VIEW_TRAINING_FIELDS).toEqual(planRelevant(TRAINING_SESSION_FIELDS));
  });
});

describe("hasPlanRelevantChange vergleicht die ganze Planer-Sicht (R5F-10)", () => {
  /** Je Feld der Planer-Sicht eine Änderung, die einen Tagesplan anders ausfallen lassen kann. */
  const CHANGE_PER_FIELD: Record<string, Partial<PlanRelevantProfile>> = {
    age: { age: 35 },
    sex: { sex: "MALE" },
    heightCm: { heightCm: 170 },
    weightKg: { weightKg: 61.5 },
    activityLevel: { activityLevel: "HIGH" },
    goal: { goal: "LOSE_WEIGHT" },
    goalRateKgPerWeek: { goalRateKgPerWeek: 0.25 },
    sportType: { sportType: "ENDURANCE" },
    dietType: { dietType: "VEGAN" },
    likedFoods: { likedFoods: ["Skyr"] },
    dislikedFoods: { dislikedFoods: ["Paprika", "Pilze"] },
    allergies: { allergies: ["Erdnüsse"] },
    trainingSessions: { trainingSessions: [profile.trainingSessions[1]] },
  };

  /** Je Feld der Trainings-Auswahl eine geänderte erste Montagseinheit. */
  const monday = profile.trainingSessions[0];
  const TRAINING_CHANGE_PER_FIELD: Record<string, Session> = {
    weekday: { ...monday, weekday: 2 },
    startTime: { ...monday, startTime: "19:00" },
    durationMin: { ...monday, durationMin: 90 },
    sportType: { ...monday, sportType: "TEAM_SPORT" },
  };

  it("vergleicht genau die Felder der Planer-Sicht (ohne id)", () => {
    expect([...COMPARED_PLAN_RELEVANT_FIELDS].sort()).toEqual(COMPARED_VIEW_FIELDS);
  });

  it.each(COMPARED_VIEW_FIELDS)("erkennt eine Änderung an %s", (field) => {
    const change = CHANGE_PER_FIELD[field];
    expect(change, `Für das Feld ${field} fehlt ein Änderungsbeispiel`).toBeDefined();
    expect(hasPlanRelevantChange(profile, { ...profile, ...change })).toBe(true);
  });

  it.each(VIEW_TRAINING_FIELDS)("erkennt eine Änderung am Trainingsfeld %s", (field) => {
    const changed = TRAINING_CHANGE_PER_FIELD[field];
    expect(changed, `Für das Trainingsfeld ${field} fehlt ein Änderungsbeispiel`).toBeDefined();
    expect(hasPlanRelevantChange(profile, { ...profile, trainingSessions: [changed, profile.trainingSessions[1]] })).toBe(true);
  });
});
