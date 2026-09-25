import { addDays, todayForUser, toDbDate } from "../calendarDate";
import { prisma } from "../db";
import { calcFullTargets } from "../nutrition";
import { getPantryContextForHousehold } from "../rotation/rotationService";
import { getBudgetContextForHousehold } from "../budget/budgetContext";
import { dbRecipeToSearchable } from "../agents/searchableRecipe";
import { VARIETY_WINDOW_DAYS } from "../agents/decision/softScoring";
import { createFoodPreferenceContext } from "../recipes/foodPreferences";
import { attachStructuredIngredients, loadFoodCatalog } from "../recipes/recipeService";
import type { PlanningContext, MemberPlanningContext } from "./types";

/**
 * Lädt ALLES, was der Planner braucht, in wenigen, gezielten Queries (keine
 * N Rezepte × N Queries, siehe Abschnitt 32): eine Query für die
 * Haushaltsmitglieder+Profile, eine für den heutigen Log-Stand pro Mitglied,
 * eine gemeinsame für Pantry (via getPantryContextForHousehold), eine
 * gemeinsame für Budget (via getBudgetContextForHousehold), eine für die
 * Kandidaten-Rezepte, eine für die Varianten-Historie. `memberIds` sind
 * bereits vom Aufrufer auf tatsächliche Mitglieder DIESES Haushalts geprüft
 * (siehe validation/mealPlan.ts + service), hier wird nicht erneut vertraut,
 * sondern erneut nach `householdId` gefiltert.
 */
export async function buildPlanningContext(
  householdId: string,
  householdMemberIds: string[] | null,
  now: Date = new Date(),
): Promise<PlanningContext> {
  const memberRows = await prisma.householdMember.findMany({
    where: {
      householdId,
      ...(householdMemberIds ? { id: { in: householdMemberIds } } : {}),
    },
    include: {
      user: { select: { name: true } },
      // Profile ist 1:1 an User gebunden, nicht an HouseholdMember - separat unten geladen.
    },
  });

  const profiles = await prisma.profile.findMany({
    where: { userId: { in: memberRows.map((m) => m.userId) } },
    include: { allergies: true, likedFoods: true, dislikedFoods: true },
  });
  const profileByUserId = new Map(profiles.map((p) => [p.userId, p]));

  const today = todayForUser(now);
  const logEntries = await prisma.logEntry.findMany({
    where: { profileId: { in: profiles.map((p) => p.id) }, date: toDbDate(today) },
  });
  const consumedByProfileId = new Map<string, { kcal: number; proteinG: number; carbsG: number; fatG: number }>();
  for (const entry of logEntries) {
    const acc = consumedByProfileId.get(entry.profileId) ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
    acc.kcal += entry.kcal;
    acc.proteinG += entry.proteinG;
    acc.carbsG += entry.carbsG;
    acc.fatG += entry.fatG;
    consumedByProfileId.set(entry.profileId, acc);
  }

  const members: MemberPlanningContext[] = [];
  for (const member of memberRows) {
    const profile = profileByUserId.get(member.userId);
    if (!profile) continue; // Kein Profil (z.B. Onboarding nicht abgeschlossen) -> kann nicht sinnvoll mitgeplant werden, wird nicht erfunden.

    const fullDailyTarget = calcFullTargets({
      sex: profile.sex,
      weightKg: profile.weightKg,
      heightCm: profile.heightCm,
      age: profile.age,
      activityLevel: profile.activityLevel,
      goal: profile.goal,
      goalRateKgPerWeek: profile.goalRateKgPerWeek,
      sportType: profile.sportType,
    });
    const consumed = consumedByProfileId.get(profile.id) ?? { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

    members.push({
      householdMemberId: member.id,
      profileId: profile.id,
      name: member.user.name,
      dietType: profile.dietType,
      allergies: profile.allergies.map((a) => a.label),
      likedFoods: profile.likedFoods.map((l) => l.label),
      dislikedFoods: profile.dislikedFoods.map((d) => d.label),
      fullDailyTarget,
      remainingTodayTarget: {
        kcal: Math.max(fullDailyTarget.kcal - consumed.kcal, 0),
        proteinG: Math.max(fullDailyTarget.proteinG - consumed.proteinG, 0),
        carbsG: Math.max(fullDailyTarget.carbsG - consumed.carbsG, 0),
        fatG: Math.max(fullDailyTarget.fatG - consumed.fatG, 0),
      },
    });
  }

  const [catalog, budget, dbRecipes] = await Promise.all([
    loadFoodCatalog(),
    getBudgetContextForHousehold(householdId, now),
    prisma.recipe.findMany({
      where: { OR: [{ isCustom: false }, { ownerProfileId: { in: members.map((m) => m.profileId) } }] },
    }),
  ]);
  const [pantry, candidates] = await Promise.all([
    getPantryContextForHousehold(householdId, now, catalog),
    attachStructuredIngredients(dbRecipes.map(dbRecipeToSearchable)),
  ]);
  const foodPreferences = createFoodPreferenceContext(
    {
      favoriteFoods: members.flatMap((m) => m.likedFoods),
      dislikedFoods: members.flatMap((m) => m.dislikedFoods),
    },
    catalog,
  );

  const varietySince = addDays(today, -VARIETY_WINDOW_DAYS);
  const recentLogs = await prisma.logEntry.findMany({
    where: { profileId: { in: members.map((m) => m.profileId) }, date: { gte: toDbDate(varietySince) }, recipeId: { not: null } },
    select: { recipeId: true },
  });
  const recentRecipeCounts = new Map<string, number>();
  for (const log of recentLogs) {
    if (!log.recipeId) continue;
    recentRecipeCounts.set(log.recipeId, (recentRecipeCounts.get(log.recipeId) ?? 0) + 1);
  }

  return { householdId, members, excludedIngredients: [], pantry, budget, candidates, foodPreferences, recentRecipeCounts };
}
