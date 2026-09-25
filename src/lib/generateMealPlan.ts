import type { MealSlot, Prisma } from "@prisma/client";
import { addDays, fromDbDate, startOfWeek, toDbDate, weekdayIndex, type CalendarDate } from "./calendarDate";
import { prisma } from "./db";
import { isUniqueConstraintError } from "./prismaErrors";
import { calcFullTargets } from "./nutrition";
import { matchesAllergen } from "./foodMatching";
import { createFoodPreferenceContext, isDislikedHit, isLikedHit, type FoodPreferenceContext } from "./recipes/foodPreferences";
import { loadFoodCatalog, loadStructuredIngredients } from "./recipes/recipeService";
import type { StructuredIngredient } from "./recipes/types";
import {
  MAX_VARIETY_ACCURACY_LOSS,
  buildDayPlan,
  computeJointPortionScales,
  computePortionScale,
  dayMacroDeviation,
  selectRecipeForSlot,
  type RecipeCandidate,
} from "./planner";

/**
 * Rezept-ID -> wie oft das Rezept in der laufenden Wochenplanung bereits
 * gewählt wurde. Gilt nur für einen Generierungslauf (nie modulweit oder in
 * der DB gespeichert) und geht als weicher Abschlag in die Rezeptwahl ein,
 * siehe planner.ts:repetitionPenalty().
 */
export type RecipeUsage = Map<string, number>;

function addUsage(usage: RecipeUsage, recipeIds: string[]) {
  for (const id of recipeIds) usage.set(id, (usage.get(id) ?? 0) + 1);
}

/** Bereits gespeicherte Tage derselben Woche (Montag bis Sonntag), damit auch einzeln erzeugte Tage (Dashboard) zur Woche passen. */
async function loadWeekUsage(profileId: string, day: CalendarDate): Promise<RecipeUsage> {
  const monday = startOfWeek(day);
  const days = await prisma.mealPlanDay.findMany({
    where: { profileId, date: { gte: toDbDate(monday), lte: toDbDate(addDays(monday, 6)) } },
    select: { items: { select: { recipeId: true } } },
  });
  const usage: RecipeUsage = new Map();
  for (const d of days) addUsage(usage, d.items.map((item) => item.recipeId));
  return usage;
}

const DAY_PLAN_INCLUDE = { items: { include: { recipe: true }, orderBy: { time: "asc" } } } satisfies Prisma.MealPlanDayInclude;

function findStoredDayPlan(profileId: string, day: CalendarDate) {
  return prisma.mealPlanDay.findUnique({ where: { profileId_date: { profileId, date: toDbDate(day) } }, include: DAY_PLAN_INCLUDE });
}

type NewDayPlan = Omit<Prisma.MealPlanDayUncheckedCreateInput, "profileId" | "date">;

/**
 * Speichert einen neu erzeugten Tag. Hat ein paralleler Request (z.B. Dashboard und Food Assistant
 * gleichzeitig, oder /plan in zwei Tabs) denselben Tag inzwischen gespeichert, verletzt das den
 * Unique-Index [profileId, date]. Dann gilt der zuerst gespeicherte Plan, damit beide Aufrufe
 * denselben stabilen Tag zeigen - genau wie bei einem Aufruf kurz danach.
 */
async function saveDayPlan(profileId: string, day: CalendarDate, plan: NewDayPlan) {
  try {
    return await prisma.mealPlanDay.create({ data: { profileId, date: toDbDate(day), ...plan }, include: DAY_PLAN_INCLUDE });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const savedConcurrently = await findStoredDayPlan(profileId, day);
    if (!savedConcurrently) throw error;
    return savedConcurrently;
  }
}

/**
 * Holt den Plan für einen Tag aus der DB, oder generiert und speichert ihn,
 * falls noch keiner existiert. Ein einmal generierter Tag bleibt stabil,
 * damit Nutzer sich darauf verlassen können (kein Neu-Mischen bei jedem Aufruf).
 *
 * `day` ist ein Kalendertag des Nutzers (z.B. `todayForUser()`), kein Zeitpunkt:
 * Ein Plan gehört zu Profil + Kalendertag, unabhängig von der Serverzeitzone.
 *
 * `weekUsage`: Rezeptverwendung der laufenden Wochenplanung (siehe
 * getOrGenerateWeekPlan). Wird sie nicht übergeben, wird sie aus den bereits
 * gespeicherten Tagen derselben Woche gelesen. Ein neu erzeugter Tag trägt
 * seine Rezepte in `weekUsage` ein; ein bereits gespeicherter Tag ändert sie nicht.
 * Hat ein paralleler Request den Tag während der Erzeugung gespeichert, zählen
 * dessen Rezepte (sie standen noch nicht in `weekUsage`).
 */
export async function getOrGenerateDayPlan(profileId: string, day: CalendarDate, weekUsage?: RecipeUsage) {
  const existing = await findStoredDayPlan(profileId, day);
  if (existing) return existing;

  const usage = weekUsage ?? (await loadWeekUsage(profileId, day));

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

  const weekday = weekdayIndex(day); // 0 = Montag, wie TrainingSession.weekday
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
  const hasPreferences = likedLabels.length + dislikedLabels.length > 0;

  // Der Katalog wird nur gebraucht, wenn es Allergien oder Präferenzen gibt.
  const catalog = allergyLabels.length > 0 || hasPreferences ? await loadFoodCatalog() : undefined;

  // Allergien sind ein harter Ausschluss (gemeinsame Auflösung, siehe recipes/allergens.ts).
  const compatibleRecipes = allRecipes.filter((r) => {
    const dietTypes = JSON.parse(r.dietTypes) as string[];
    const allergens = JSON.parse(r.allergens) as string[];
    if (!dietTypes.includes(profile.dietType)) return false;
    if (matchesAllergen(allergens, allergyLabels, JSON.parse(r.ingredients) as string[], catalog)) return false;
    return true;
  });

  // Lieblinge/Abneigungen über die gemeinsame Food-Auflösung (Katalog für strukturierte
  // Rezepte, Text für Altrezepte). Nur laden, wenn es überhaupt Präferenzen gibt.
  let preferences: FoodPreferenceContext | null = null;
  let structuredByRecipe = new Map<string, StructuredIngredient[]>();
  if (hasPreferences && catalog) {
    structuredByRecipe = await loadStructuredIngredients(compatibleRecipes.map((r) => r.id));
    preferences = createFoodPreferenceContext({ favoriteFoods: likedLabels, dislikedFoods: dislikedLabels }, catalog);
  }

  const candidatesBySlot = new Map<MealSlot, RecipeCandidate[]>();
  for (const r of compatibleRecipes) {
    const mealSlots = JSON.parse(r.mealSlots) as MealSlot[];
    const ingredients = JSON.parse(r.ingredients) as string[];
    const match = preferences?.matchFor({ id: r.id, ingredients, structured: structuredByRecipe.get(r.id) });
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
      ...(match ? { preferenceHit: { liked: isLikedHit(match), disliked: isDislikedHit(match) } } : {}),
    };
    for (const slot of mealSlots) {
      if (!candidatesBySlot.has(slot)) candidatesBySlot.set(slot, []);
      candidatesBySlot.get(slot)!.push(candidate);
    }
  }

  const pickDay = (weekUsage?: RecipeUsage) => {
    const usedRecipeIds = new Set<string>();
    const items: {
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
        weekUsage,
      );
      if (!chosen) continue;

      usedRecipeIds.add(chosen.id);
      items.push({
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
    const scales = computeJointPortionScales(
      targets,
      items.map((item) => ({ recipe: item.recipe, priorScale: item.priorScale })),
    );
    const deviation = dayMacroDeviation(
      targets,
      items.map((item, i) => ({ recipe: item.recipe, scale: scales[i] ?? item.priorScale })),
    );
    return { items, scales, deviation };
  };

  // Variety ist nur eine Präferenz: Trifft der Tag mit den abwechslungsreicheren
  // Rezepten die Tagesziele spürbar schlechter als ohne Wochenabschlag (z.B. weil
  // sich mehrere sehr proteinreiche Gerichte stapeln), gilt die Auswahl ohne Abschlag.
  let picked = pickDay(usage);
  if (usage.size > 0) {
    const plain = pickDay();
    if (picked.deviation > plain.deviation + MAX_VARIETY_ACCURACY_LOSS) picked = plain;
  }
  const { items: chosenItems, scales: jointScales } = picked;

  const saved = await saveDayPlan(profileId, day, {
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
  });

  addUsage(usage, saved.items.map((item) => item.recipeId));
  return saved;
}

/**
 * Die sieben Tage ab `weekStart` (Montag) in Reihenfolge. Fehlende Tage werden
 * nacheinander erzeugt (nicht parallel), weil jeder Tag wissen muss, welche
 * Rezepte die Tage davor gewählt haben. Bereits gespeicherte Tage bleiben
 * unverändert, zählen aber ebenfalls für die Rezeptverwendung, auch wenn sie
 * später in der Woche liegen als ein neu erzeugter Tag.
 */
export async function getOrGenerateWeekPlan(profileId: string, weekStart: CalendarDate) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const stored = await prisma.mealPlanDay.findMany({
    where: { profileId, date: { gte: toDbDate(days[0]), lte: toDbDate(days[6]) } },
    include: DAY_PLAN_INCLUDE,
  });
  const storedByDay = new Map(stored.map((d) => [fromDbDate(d.date), d]));

  const usage: RecipeUsage = new Map();
  for (const d of stored) addUsage(usage, d.items.map((item) => item.recipeId));

  const plans = [];
  for (const day of days) {
    plans.push(storedByDay.get(day) ?? (await getOrGenerateDayPlan(profileId, day, usage)));
  }
  return plans;
}
