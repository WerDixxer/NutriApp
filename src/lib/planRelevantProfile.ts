import { normalizeFoodLabel } from "./recipes/catalog";

/**
 * Die Profilwerte, die der persönliche Tagesplaner tatsächlich liest (generateMealPlan.ts:planDay):
 * - Tagesziele (nutrition.ts:calcFullTargets): Alter, Geschlecht, Größe, Gewicht, Aktivität, Ziel,
 *   Tempo und Sportart
 * - Ernährungsform, Allergien, Lieblinge und Abneigungen (Rezeptauswahl)
 * - Training (planner.ts:buildDayPlan): je Wochentag die erste Einheit mit Startzeit, Dauer, Sportart
 *
 * Nicht dabei, weil der Planer sie nicht liest: Prioritäten und die Trainingsintensität.
 */
export interface PlanRelevantProfile {
  age: number;
  sex: string;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
  goal: string;
  goalRateKgPerWeek: number;
  sportType: string;
  dietType: string;
  likedFoods: string[];
  dislikedFoods: string[];
  allergies: string[];
  trainingSessions: { weekday: number; startTime: string; durationMin: number; sportType: string }[];
}

const TARGET_AND_DIET_FIELDS = [
  "age",
  "sex",
  "heightCm",
  "weightKg",
  "activityLevel",
  "goal",
  "goalRateKgPerWeek",
  "sportType",
  "dietType",
] as const satisfies readonly (keyof PlanRelevantProfile)[];

/** Gleiche Einträge nach der Normalisierung des Food-Katalogs; Reihenfolge, Groß-/Kleinschreibung und Dopplungen zählen nicht. */
function sameLabels(a: string[], b: string[]): boolean {
  const normalizedA = new Set(a.map(normalizeFoodLabel));
  const normalizedB = new Set(b.map(normalizeFoodLabel));
  return normalizedA.size === normalizedB.size && [...normalizedA].every((label) => normalizedB.has(label));
}

/** Das Training, wie der Planer es sieht: je Wochentag (0-6) die erste Einheit dieses Tages, ohne Intensität. */
function trainingAsPlanned(sessions: PlanRelevantProfile["trainingSessions"]): string[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const session = sessions.find((s) => s.weekday === weekday);
    return session ? `${session.startTime}|${session.durationMin}|${session.sportType}` : "";
  });
}

/** Kann der Wechsel von `before` zu `after` einen Tagesplan anders ausfallen lassen? */
export function hasPlanRelevantChange(before: PlanRelevantProfile, after: PlanRelevantProfile): boolean {
  if (TARGET_AND_DIET_FIELDS.some((field) => before[field] !== after[field])) return true;
  if (!sameLabels(before.likedFoods, after.likedFoods)) return true;
  if (!sameLabels(before.dislikedFoods, after.dislikedFoods)) return true;
  if (!sameLabels(before.allergies, after.allergies)) return true;

  const trainingBefore = trainingAsPlanned(before.trainingSessions);
  const trainingAfter = trainingAsPlanned(after.trainingSessions);
  return trainingBefore.some((session, weekday) => session !== trainingAfter[weekday]);
}
