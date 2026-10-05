import type { Prisma } from "@prisma/client";
import { normalizeFoodLabel } from "./recipes/catalog";

/**
 * Die Sicht des persönlichen Tagesplaners auf das Profil (R5F-10): Der Planer (generateMealPlan.ts:
 * planDay, Neuplanung, Einzelersatz) liest das Profil ausschließlich über diese Auswahl, und die
 * Profil-Route vergleicht vor dem Speichern genau diese Werte (hasPlanRelevantChange). Braucht der
 * Planer ein weiteres Profilfeld, muss es hier ergänzt werden - und damit auch im Vergleich.
 *
 * - Tagesziele (nutrition.ts:calcFullTargets): Alter, Geschlecht, Größe, Gewicht, Aktivität, Ziel,
 *   Tempo und Sportart
 * - Ernährungsform, Allergien, Lieblinge und Abneigungen (Rezeptauswahl)
 * - Training (planner.ts:buildDayPlan): je Wochentag die erste Einheit mit Startzeit, Dauer, Sportart
 *
 * Nicht dabei, weil der Planer sie nicht liest: Prioritäten, abonnierte Trend-Tags und die
 * Trainingsintensität. `id` gehört nur für die eigenen Rezepte des Profils dazu und wird nicht
 * verglichen. Jedes Feld von Profile und TrainingSession ist in planRelevantProfile.test.ts bewusst
 * als planrelevant oder nicht planrelevant eingeordnet.
 */
export const PLAN_RELEVANT_PROFILE_SELECT = {
  id: true,
  age: true,
  sex: true,
  heightCm: true,
  weightKg: true,
  activityLevel: true,
  goal: true,
  goalRateKgPerWeek: true,
  sportType: true,
  dietType: true,
  likedFoods: { select: { label: true } },
  dislikedFoods: { select: { label: true } },
  allergies: { select: { label: true } },
  trainingSessions: { select: { weekday: true, startTime: true, durationMin: true, sportType: true } },
} satisfies Prisma.ProfileSelect;

/** Ein gespeichertes Profil in der Sicht des Planers. */
export type PlanRelevantProfileRow = Prisma.ProfileGetPayload<{ select: typeof PLAN_RELEVANT_PROFILE_SELECT }>;

type LabelListField = "likedFoods" | "dislikedFoods" | "allergies";

/** Die verglichenen Werte: die Sicht des Planers ohne `id`, Listen als Texte. */
export type PlanRelevantProfile = Omit<PlanRelevantProfileRow, "id" | LabelListField> & Record<LabelListField, string[]>;

/** Die Vergleichswerte eines gespeicherten Profils (Vorher-Stand in der Profil-Route). */
export function toPlanRelevantProfile({ id: _id, likedFoods, dislikedFoods, allergies, ...values }: PlanRelevantProfileRow): PlanRelevantProfile {
  const labels = (tags: { label: string }[]) => tags.map((tag) => tag.label);
  return { ...values, likedFoods: labels(likedFoods), dislikedFoods: labels(dislikedFoods), allergies: labels(allergies) };
}

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

function sameTraining(a: PlanRelevantProfile["trainingSessions"], b: PlanRelevantProfile["trainingSessions"]): boolean {
  const trainingA = trainingAsPlanned(a);
  const trainingB = trainingAsPlanned(b);
  return trainingA.every((session, weekday) => session === trainingB[weekday]);
}

function sameValue<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * Wie jedes Feld der Planer-Sicht verglichen wird. Der Typ verlangt genau einen Eintrag je Feld:
 * Ein neues Feld in PLAN_RELEVANT_PROFILE_SELECT ohne Vergleich ist ein Typfehler.
 */
const SAME_FOR_PLANNER: { [Field in keyof PlanRelevantProfile]: (a: PlanRelevantProfile[Field], b: PlanRelevantProfile[Field]) => boolean } = {
  age: sameValue,
  sex: sameValue,
  heightCm: sameValue,
  weightKg: sameValue,
  activityLevel: sameValue,
  goal: sameValue,
  goalRateKgPerWeek: sameValue,
  sportType: sameValue,
  dietType: sameValue,
  likedFoods: sameLabels,
  dislikedFoods: sameLabels,
  allergies: sameLabels,
  trainingSessions: sameTraining,
};

/** Die Felder, die hasPlanRelevantChange vergleicht (für den Vollständigkeitstest). */
export const COMPARED_PLAN_RELEVANT_FIELDS = Object.keys(SAME_FOR_PLANNER) as (keyof PlanRelevantProfile)[];

function sameField<Field extends keyof PlanRelevantProfile>(field: Field, before: PlanRelevantProfile, after: PlanRelevantProfile): boolean {
  return SAME_FOR_PLANNER[field](before[field], after[field]);
}

/** Kann der Wechsel von `before` zu `after` einen Tagesplan anders ausfallen lassen? */
export function hasPlanRelevantChange(before: PlanRelevantProfile, after: PlanRelevantProfile): boolean {
  return COMPARED_PLAN_RELEVANT_FIELDS.some((field) => !sameField(field, before, after));
}
