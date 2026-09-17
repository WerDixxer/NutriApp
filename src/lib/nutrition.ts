import type { ActivityLevel, Goal, Sex, SportType } from "@prisma/client";

export interface MacroTarget {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  SEDENTARY: 1.2,
  LIGHT: 1.375,
  MODERATE: 1.55,
  HIGH: 1.725,
  ATHLETE: 1.9,
};

const KCAL_PER_KG_FAT = 7700;

/**
 * Realistisches Maximaltempo je Ziel (kg/Woche). Muskelaufbau ist bewusst eng
 * begrenzt: schneller als ~0.3kg/Woche ist beim Menschen kein Muskelaufbau
 * mehr, sondern überwiegend Fettaufbau ("Dirty Bulk"). Dafür braucht es
 * keinen Kalorienüberschuss in der Größenordnung von 1000+ kcal/Tag.
 */
export const MAX_RATE_KG_PER_WEEK: Record<Goal, number> = {
  LOSE_WEIGHT: 1.0,
  GAIN_MUSCLE: 0.3,
  GAIN_WEIGHT: 0.75,
  MAINTAIN: 0,
};

export function clampGoalRate(goal: Goal, rate: number): number {
  return Math.min(Math.max(rate, 0), MAX_RATE_KG_PER_WEEK[goal]);
}

/** Mifflin-St Jeor */
export function calcBMR(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "MALE" ? base + 5 : base - 161;
}

export function calcTDEE(bmr: number, activityLevel: ActivityLevel): number {
  return bmr * ACTIVITY_FACTORS[activityLevel];
}

export function calcGoalCalories(
  tdee: number,
  goal: Goal,
  goalRateKgPerWeek: number,
): number {
  const safeRate = clampGoalRate(goal, goalRateKgPerWeek);
  const dailyDelta = (safeRate * KCAL_PER_KG_FAT) / 7;
  switch (goal) {
    case "LOSE_WEIGHT":
      // Nie mehr als 25% unter dem Gesamtumsatz: größere Defizite sind auf
      // Dauer weder haltbar noch notwendig, auch wenn ein hohes Tempo gewählt wurde.
      return Math.round(Math.max(tdee - dailyDelta, tdee * 0.75));
    case "GAIN_WEIGHT":
    case "GAIN_MUSCLE":
      // Nie mehr als 20% über dem Gesamtumsatz: ein größerer Überschuss baut
      // überwiegend Fett auf, nicht schneller Muskeln.
      return Math.round(Math.min(tdee + dailyDelta, tdee * 1.2));
    case "MAINTAIN":
    default:
      return Math.round(tdee);
  }
}

/** Protein target in g/kg bodyweight, adjusted for goal and sport type. */
function proteinPerKg(goal: Goal, sportType: SportType): number {
  if (goal === "GAIN_MUSCLE") return sportType === "STRENGTH" ? 2.2 : 2.0;
  if (goal === "LOSE_WEIGHT") return 2.0; // hoch halten schützt Muskelmasse im Defizit
  if (sportType === "STRENGTH") return 1.9;
  if (sportType === "ENDURANCE") return 1.5;
  if (sportType === "ATHLETIC" || sportType === "TEAM_SPORT") return 1.7;
  return 1.4;
}

/** Fat target as fraction of total kcal. */
function fatShare(goal: Goal): number {
  if (goal === "LOSE_WEIGHT") return 0.3; // Sättigung im Defizit
  if (goal === "GAIN_MUSCLE" || goal === "GAIN_WEIGHT") return 0.25;
  return 0.28;
}

export function calcMacros(
  kcalTarget: number,
  weightKg: number,
  goal: Goal,
  sportType: SportType,
): MacroTarget {
  const proteinG = Math.round(proteinPerKg(goal, sportType) * weightKg);
  const proteinKcal = proteinG * 4;

  const fatKcal = kcalTarget * fatShare(goal);
  const fatG = Math.round(fatKcal / 9);

  const remainingKcal = Math.max(kcalTarget - proteinKcal - fatG * 9, 0);
  const carbsG = Math.round(remainingKcal / 4);

  return { kcal: Math.round(kcalTarget), proteinG, carbsG, fatG };
}

export interface FullTargets extends MacroTarget {
  bmr: number;
  tdee: number;
}

export function calcFullTargets(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activityLevel: ActivityLevel;
  goal: Goal;
  goalRateKgPerWeek: number;
  sportType: SportType;
}): FullTargets {
  const bmr = calcBMR(input.sex, input.weightKg, input.heightCm, input.age);
  const tdee = calcTDEE(bmr, input.activityLevel);
  const kcalTarget = calcGoalCalories(tdee, input.goal, input.goalRateKgPerWeek);
  const macros = calcMacros(kcalTarget, input.weightKg, input.goal, input.sportType);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), ...macros };
}
