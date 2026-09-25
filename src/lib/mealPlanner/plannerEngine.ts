import { addDays, todayForUser, type CalendarDate } from "../calendarDate";
import { computeJointPortionScales, type RecipeCandidate } from "../planner";
import type { MacroTarget } from "../nutrition";
import type { SearchableRecipe } from "../agents/recipeSearch";
import { filterHouseholdCandidates } from "./hardConstraints";
import { buildSlotTargets } from "./slotWeights";
import { mainIngredientToken, scoreCandidate, type MealSlotScoringContext } from "./softScoring";
import type { GeneratedMeal, GeneratedMealPlan, PlannableMealSlot, PlanningContext, UnmetSlot } from "./types";

export interface GeneratePlanInput {
  /** Erster Kalendertag des Plans (Nutzerzeit, siehe src/lib/calendarDate.ts). */
  startDate: CalendarDate;
  days: number;
  slots: PlannableMealSlot[];
  maxCookingTimeMin?: number;
}

function sumTargets(targets: MacroTarget[]): MacroTarget {
  return targets.reduce(
    (acc, t) => ({ kcal: acc.kcal + t.kcal, proteinG: acc.proteinG + t.proteinG, carbsG: acc.carbsG + t.carbsG, fatG: acc.fatG + t.fatG }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

const RECENT_MAIN_INGREDIENT_WINDOW = 4;

// planner.ts:SlotTarget trägt zusätzlich `time` (Uhrzeit), das der Haushalts-Planer nicht
// verwendet (Abschnitt 3: keine trainingszeitabhängige Slot-Planung über mehrere Personen
// hinweg). Statt eine künstliche `time`-Attrappe zu erfinden, nur um planner.ts:computePortionScale
// (eine reine Ein-Zeilen-Formel) typkompatibel aufzurufen, hier dieselbe Formel/Grenzen direkt.
function estimatePortionScale(targetKcal: number, recipeKcal: number): number {
  const raw = targetKcal / Math.max(recipeKcal, 1);
  return Math.min(Math.max(raw, 0.4), 2.5);
}

/**
 * Deterministischer Planungsalgorithmus (Abschnitt 17/18): gleiche Eingaben
 * (Context + Input) führen immer zum gleichen Plan. Tie-Breaking: Score ->
 * Kalorien-Nähe (sekundärer Score) -> Rezept-ID (string-sortiert), nie
 * Zufall. Plant Tag für Tag, Slot für Slot, berücksichtigt dabei den
 * bisherigen Plan (Zutaten-Wiederverwendung, Varianten-Historie), und
 * skaliert danach JEDEN Tag gemeinsam über computeJointPortionScales()
 * (siehe planner.ts) auf die kombinierten Tagesziele.
 */
export function generateMealPlan(context: PlanningContext, input: GeneratePlanInput, now: Date = new Date()): GeneratedMealPlan {
  if (context.members.length === 0) {
    return { status: "NO_VALID_PLAN", meals: [], unmetSlots: [] };
  }

  const { allowed, rejected } = filterHouseholdCandidates(
    context.candidates,
    context.members,
    context.excludedIngredients,
    context.foodPreferences?.catalog,
  );
  if (allowed.length === 0) {
    const reason =
      rejected.size > 0
        ? "Keines der verfügbaren Rezepte erfüllt Allergien/Ernährungsform aller geplanten Mitglieder."
        : "Keine passenden Rezepte in der Datenbank vorhanden.";
    return { status: "NO_VALID_PLAN", meals: [], unmetSlots: input.slots.map((slot) => ({ date: input.startDate, slot, reason })) };
  }

  const meals: GeneratedMeal[] = [];
  const unmetSlots: UnmetSlot[] = [];

  const usedIngredientsInPlan = new Set<string>();
  const inPlanRecipeCounts = new Map<string, number>();
  let recentMainIngredients: string[] = [];
  const today = todayForUser(now);

  for (let dayIndex = 0; dayIndex < input.days; dayIndex++) {
    const date = addDays(input.startDate, dayIndex);

    // Für heute zählt, was die Mitglieder bereits gegessen haben; für alle anderen Tage das volle Ziel.
    const dailyTargets = context.members.map((m) => (date === today ? m.remainingTodayTarget : m.fullDailyTarget));
    const combinedDailyTarget = sumTargets(dailyTargets);
    const slotTargets = buildSlotTargets(combinedDailyTarget, input.slots);

    const dayChoices: { slot: PlannableMealSlot; candidate: SearchableRecipe; priorScale: number }[] = [];

    for (const slotTarget of slotTargets) {
      const slotCandidates = allowed.filter((c) => c.mealSlots.includes(slotTarget.slot));
      if (slotCandidates.length === 0) {
        unmetSlots.push({ date, slot: slotTarget.slot, reason: "Kein Rezept für diesen Mahlzeiten-Slot verfügbar." });
        continue;
      }

      const ctx: MealSlotScoringContext = {
        slotTarget,
        likedFoods: context.members.flatMap((m) => m.likedFoods),
        dislikedFoods: context.members.flatMap((m) => m.dislikedFoods),
        foodPreferences: context.foodPreferences,
        availablePantryIngredientNames: context.pantry.availableIngredientNames,
        urgentPantryIngredientNames: context.pantry.urgentIngredientNames,
        pantryFoodIdsByName: context.pantry.foodIdsByName,
        remainingBudgetCents: context.budget.remainingWeekBudgetCents ?? context.budget.remainingMonthBudgetCents ?? null,
        recentRecipeCount: 0,
        usedIngredientsInPlan,
        recentMainIngredients,
      };

      let best: { candidate: SearchableRecipe; total: number; caloriesCloseness: number; reasons: string[] } | null = null;
      for (const candidate of slotCandidates) {
        const recentRecipeCount = (context.recentRecipeCounts.get(candidate.id) ?? 0) + (inPlanRecipeCounts.get(candidate.id) ?? 0);
        const { total, factorResults } = scoreCandidate(candidate, { ...ctx, recentRecipeCount }, input.maxCookingTimeMin);
        const caloriesCloseness = factorResults.find((f) => f.factor === "calories")?.rawScore ?? 0;
        const reasons = factorResults.map((f) => f.reason).filter((r): r is string => !!r);

        if (
          !best ||
          total > best.total ||
          (total === best.total && caloriesCloseness > best.caloriesCloseness) ||
          (total === best.total && caloriesCloseness === best.caloriesCloseness && candidate.id < best.candidate.id)
        ) {
          best = { candidate, total, caloriesCloseness, reasons };
        }
      }
      if (!best) {
        unmetSlots.push({ date, slot: slotTarget.slot, reason: "Kein Kandidat konnte bewertet werden." });
        continue;
      }

      dayChoices.push({ slot: slotTarget.slot, candidate: best.candidate, priorScale: estimatePortionScale(slotTarget.kcal, best.candidate.kcal) });
      meals.push({ date, slot: slotTarget.slot, recipeId: best.candidate.id, recipeName: best.candidate.name, portionMultiplier: dayChoices.at(-1)!.priorScale, reasons: best.reasons });

      inPlanRecipeCounts.set(best.candidate.id, (inPlanRecipeCounts.get(best.candidate.id) ?? 0) + 1);
      for (const ing of best.candidate.ingredients) usedIngredientsInPlan.add(ing);
      const mainIngredient = mainIngredientToken(best.candidate.ingredients);
      if (mainIngredient) {
        recentMainIngredients = [...recentMainIngredients, mainIngredient].slice(-RECENT_MAIN_INGREDIENT_WINDOW);
      }
    }

    // Alle heute gewählten Rezepte gemeinsam auf die kombinierten Tagesziele skalieren (siehe planner.ts).
    if (dayChoices.length > 0) {
      const scales = computeJointPortionScales(
        combinedDailyTarget,
        dayChoices.map((c) => ({ recipe: c.candidate as RecipeCandidate, priorScale: c.priorScale })),
      );
      const dayMealsStartIndex = meals.length - dayChoices.length;
      for (let i = 0; i < dayChoices.length; i++) {
        meals[dayMealsStartIndex + i].portionMultiplier = scales[i] ?? dayChoices[i].priorScale;
      }
    }
  }

  if (meals.length === 0) return { status: "NO_VALID_PLAN", meals: [], unmetSlots };
  return { status: unmetSlots.length > 0 ? "PARTIAL" : "SUCCESS", meals, unmetSlots };
}
