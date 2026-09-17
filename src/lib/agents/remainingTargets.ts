import { prisma } from "../db";
import { calcFullTargets, type MacroTarget } from "../nutrition";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Tagesziel minus bereits geloggte Mahlzeiten. Gemeinsam genutzt von
 * macroRescue.ts und der Decision Engine, damit "was fehlt mir heute noch"
 * an genau einer Stelle berechnet wird.
 */
export async function getRemainingDailyTargets(profileId: string, now: Date = new Date()): Promise<MacroTarget> {
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId } });

  const targets = calcFullTargets({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    goalRateKgPerWeek: profile.goalRateKgPerWeek,
    sportType: profile.sportType,
  });

  const entries = await prisma.logEntry.findMany({ where: { profileId, date: startOfDay(now) } });
  const consumed = entries.reduce(
    (acc, e) => ({
      kcal: acc.kcal + e.kcal,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );

  return {
    kcal: Math.max(targets.kcal - consumed.kcal, 0),
    proteinG: Math.max(targets.proteinG - consumed.proteinG, 0),
    carbsG: Math.max(targets.carbsG - consumed.carbsG, 0),
    fatG: Math.max(targets.fatG - consumed.fatG, 0),
  };
}
