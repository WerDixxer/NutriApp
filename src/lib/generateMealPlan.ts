import type { MealSlot } from "@prisma/client";
import { prisma } from "./db";
import { calcFullTargets } from "./nutrition";
import { matchesAllergen } from "./foodMatching";
import {
  buildDayPlan,
  computeJointPortionScales,
  computePortionScale,
  selectRecipeForSlot,
  type RecipeCandidate,
} from "./planner";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Holt den Plan für einen Tag aus der DB, oder generiert und speichert ihn,
 * falls noch keiner existiert. Ein einmal generierter Tag bleibt stabil,
 * damit Nutzer sich darauf verlassen können (kein Neu-Mischen bei jedem Aufruf).
 */
export async function getOrGenerateDayPlan(profileId: string, date: Date) {
  const day = startOfDay(date);

  const existing = await prisma.mealPlanDay.findUnique({
    where: { profileId_date: { profileId, date: day } },
    include: { items: { include: { recipe: true }, orderBy: { time: "asc" } } },
  });
  if (existing) return existing;

  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: {
      allergies: true,
      likedFoods: true,
      dislikedFoods: true,
      trainingSessions: true,
    },
  });

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

  const weekday = (day.getDay() + 6) % 7; // JS: 0=So -> wir wollen 0=Mo
  const todaysSession = profile.trainingSessions.find((s) => s.weekday === weekday);

  const slotTargets = buildDayPlan(
    targets,
    todaysSession
      ? {
          startTime: todaysSession.startTime,
          durationMin: todaysSession.durationMin,
          sportType: todaysSession.sportType,
        }
      : undefined,
  );

  const allRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
  });
  const allergyLabels = profile.allergies.map((a) => a.label);
  const dislikedLabels = profile.dislikedFoods.map((d) => d.label);
  const likedLabels = profile.likedFoods.map((l) => l.label);

  const compatibleRecipes = allRecipes.filter((r) => {
    const dietTypes = JSON.parse(r.dietTypes) as string[];
    const allergens = JSON.parse(r.allergens) as string[];
    if (!dietTypes.includes(profile.dietType)) return false;
    if (matchesAllergen(allergens, allergyLabels)) return false;
    return true;
  });

  const candidatesBySlot = new Map<MealSlot, RecipeCandidate[]>();
  for (const r of compatibleRecipes) {
    const mealSlots = JSON.parse(r.mealSlots) as MealSlot[];
    const ingredients = JSON.parse(r.ingredients) as string[];
    const candidate: RecipeCandidate = {
      id: r.id,
      name: r.name,
      kcal: r.kcal,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      mealSlots,
      ingredients,
      isTrending: r.isTrending,
    };
    for (const slot of mealSlots) {
      if (!candidatesBySlot.has(slot)) candidatesBySlot.set(slot, []);
      candidatesBySlot.get(slot)!.push(candidate);
    }
  }

  const usedRecipeIds = new Set<string>();
  const chosenItems: {
    slot: MealSlot;
    time: string;
    recipeId: string;
    recipe: RecipeCandidate;
    priorScale: number;
  }[] = [];

  for (const slotTarget of slotTargets) {
    const candidates = candidatesBySlot.get(slotTarget.slot) ?? [];
    const chosen = selectRecipeForSlot(
      candidates,
      slotTarget,
      likedLabels,
      dislikedLabels,
      usedRecipeIds,
    );
    if (!chosen) continue;

    usedRecipeIds.add(chosen.id);
    chosenItems.push({
      slot: slotTarget.slot,
      time: slotTarget.time,
      recipeId: chosen.id,
      recipe: chosen,
      priorScale: computePortionScale(slotTarget, chosen),
    });
  }

  // Alle gewählten Rezepte gemeinsam auf die Tagesziele skalieren, statt jede
  // Mahlzeit isoliert nur auf ihr Kalorien-Teilziel zu bringen. So treffen am
  // Ende auch Protein/Carbs/Fett in Summe die Tagesziele, nicht nur die Kalorien.
  const jointScales = computeJointPortionScales(
    targets,
    chosenItems.map((item) => ({ recipe: item.recipe, priorScale: item.priorScale })),
  );

  const created = await prisma.mealPlanDay.create({
    data: {
      profileId,
      date: day,
      targetKcal: targets.kcal,
      targetProteinG: targets.proteinG,
      targetCarbsG: targets.carbsG,
      targetFatG: targets.fatG,
      items: {
        create: chosenItems.map((item, i) => ({
          slot: item.slot,
          time: item.time,
          recipeId: item.recipeId,
          portionMultiplier: jointScales[i] ?? item.priorScale,
        })),
      },
    },
    include: { items: { include: { recipe: true }, orderBy: { time: "asc" } } },
  });

  return created;
}
