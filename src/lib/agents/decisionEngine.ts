import { prisma } from "../db";
import { computeSingleItemScale } from "../foodMatching";
import type { MacroTarget } from "../nutrition";
import { getHouseholdIdForProfile } from "../household";
import { getPantryContextForHousehold } from "../rotation/rotationService";
import { getRemainingDailyTargets } from "./remainingTargets";
import { dbRecipeToSearchable } from "./searchableRecipe";
import { selectBestCandidate, type RejectedCandidate } from "./decision/selectBestCandidate";
import { VARIETY_WINDOW_DAYS, type ScoringContext } from "./decision/softScoring";
import type { HardConstraintContext } from "./decision/hardConstraints";
import type { AssistantQuery } from "./assistantQuery";
import { createFoodPreferenceContext } from "../recipes/foodPreferences";
import { attachStructuredIngredients, loadFoodCatalog } from "../recipes/recipeService";

export interface DecisionEngineInput {
  profileId: string;
  now?: Date;
  /** Zusätzlicher Kontext aus dem Assistant-Gespräch, z.B. explizit genannte Kalorien oder Zutaten. */
  query?: AssistantQuery;
}

export interface DecisionEngineResult {
  recipeId: string;
  recipeName: string;
  portionMultiplier: number;
  score: number;
  reasons: string[];
  rejectedCandidates: RejectedCandidate[];
  constraintsApplied: string[];
}

/**
 * Schnittstelle für "Entscheide für mich" (Zero Decision Mode). Der
 * Aufrufer (Food Assistant, später ein UI-Button) kennt nur dieses
 * Interface, nie die konkrete Implementierung.
 */
export interface DecisionEngine {
  readonly name: string;
  /** Gibt `null` zurück, wenn kein Kandidat die Hard Constraints erfüllt (sauberer Fallback, keine Notlösung). */
  decide(input: DecisionEngineInput): Promise<DecisionEngineResult | null>;
}

async function resolveTargets(profileId: string, query: AssistantQuery | undefined, now?: Date): Promise<MacroTarget> {
  const remaining = await getRemainingDailyTargets(profileId, now);
  if (!query) return remaining;
  // Explizite Angaben aus dem Gespräch (z.B. "ich habe noch 1200 kcal übrig")
  // überschreiben nur die genannten Felder, der Rest bleibt der reale Tagesrest.
  return {
    kcal: query.calories ?? remaining.kcal,
    proteinG: query.protein ?? remaining.proteinG,
    carbsG: query.carbs ?? remaining.carbsG,
    fatG: query.fat ?? remaining.fatG,
  };
}

async function loadRecentRecipeCounts(profileId: string, now: Date = new Date()): Promise<Map<string, number>> {
  const since = new Date(now);
  since.setDate(since.getDate() - VARIETY_WINDOW_DAYS);
  since.setHours(0, 0, 0, 0);

  const entries = await prisma.logEntry.findMany({
    where: { profileId, date: { gte: since }, recipeId: { not: null } },
    select: { recipeId: true },
  });

  const counts = new Map<string, number>();
  for (const e of entries) {
    if (!e.recipeId) continue;
    counts.set(e.recipeId, (counts.get(e.recipeId) ?? 0) + 1);
  }
  return counts;
}

/**
 * v1 der vollständigen Multi-Faktor Decision Engine. Lädt reale Daten (Profil,
 * Rezeptdatenbank, Tagesrest, jüngste Log-Historie, Pantry-/Rotation-Kontext)
 * und delegiert die eigentliche Entscheidung an die reine, unit-getestete
 * Funktion `selectBestCandidate()`. Pantry (Kapitel 6) und Food Waste/Rotation
 * (Kapitel 7) sind seit ihren jeweiligen Kapiteln echte Faktoren. Fiber und
 * Budget tragen weiterhin 0 bei, siehe softScoring.ts, statt Werte zu
 * erfinden. Wird ein Budget-System gebaut, ist nur softScoring.ts zu
 * erweitern, dieser Wrapper und das DecisionEngine-Interface bleiben stabil.
 *
 * Household-Kontext (Kapitel 9): `getHouseholdIdForProfile()` löst für JEDES
 * Haushaltsmitglied denselben gemeinsamen Haushalt auf, Pantry-/Rotation-
 * Kontext ist also bereits korrekt haushaltsweit geteilt. Rollen (OWNER/
 * MEMBER) sind hier nicht relevant: die Entscheidung bleibt für das
 * aufrufende Profil individuell, nur die zugrunde liegenden gemeinsamen
 * Daten (Pantry, später Budget) sind geteilt.
 */
export class MultiFactorDecisionEngine implements DecisionEngine {
  readonly name = "multi-factor-v1";

  async decide(input: DecisionEngineInput): Promise<DecisionEngineResult | null> {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { id: input.profileId },
      include: { allergies: true, likedFoods: true, dislikedFoods: true },
    });

    const dbRecipes = await prisma.recipe.findMany({
      where: { OR: [{ isCustom: false }, { ownerProfileId: input.profileId }] },
    });
    const [catalog, candidates] = await Promise.all([
      loadFoodCatalog(),
      attachStructuredIngredients(dbRecipes.map(dbRecipeToSearchable)),
    ]);
    const foodPreferences = createFoodPreferenceContext(
      { favoriteFoods: profile.likedFoods.map((l) => l.label), dislikedFoods: profile.dislikedFoods.map((d) => d.label) },
      catalog,
    );

    const [targets, recentRecipeCounts, householdId] = await Promise.all([
      resolveTargets(input.profileId, input.query, input.now),
      loadRecentRecipeCounts(input.profileId, input.now),
      getHouseholdIdForProfile(input.profileId),
    ]);

    // Vorräte aus dem Haushalt (Kapitel 6) plus in der Nachricht genannte
    // Zutaten fließen gemeinsam in den Pantry-Faktor ein. `urgentIngredientNames`
    // (Kapitel 7, echte Rotation-Dringlichkeit) speist den Food-Waste-Faktor.
    // Ohne Haushalt/ohne Pantry-Einträge bleiben beide Listen leer, die
    // Faktoren bleiben neutral (siehe softScoring.ts), nichts wird erfunden.
    const pantryContext = householdId
      ? await getPantryContextForHousehold(householdId, input.now, catalog)
      : { availableIngredientNames: [], urgentIngredientNames: [] };

    const hardCtx: HardConstraintContext = {
      allergies: [...(input.query?.allergies ?? []), ...profile.allergies.map((a) => a.label)],
      dietType: profile.dietType,
      excludedIngredients: input.query?.excludedIngredients ?? [],
      catalog,
    };

    const scoringCtx: ScoringContext = {
      targetKcal: targets.kcal,
      targetProteinG: targets.proteinG,
      targetCarbsG: targets.carbsG,
      targetFatG: targets.fatG,
      maxCookingTimeMin: input.query?.maxCookingTimeMin,
      availableIngredients: [...(input.query?.ingredients ?? []), ...pantryContext.availableIngredientNames],
      likedFoods: profile.likedFoods.map((l) => l.label),
      dislikedFoods: profile.dislikedFoods.map((d) => d.label),
      foodPreferences,
      preferences: input.query?.preferences ?? [],
      recentRecipeCounts,
      urgentPantryIngredientNames: pantryContext.urgentIngredientNames,
      pantryFoodIdsByName: pantryContext.foodIdsByName,
    };

    const selection = selectBestCandidate(candidates, hardCtx, scoringCtx);
    if (!selection) return null;

    const portionMultiplier = computeSingleItemScale(
      { kcal: targets.kcal, proteinG: targets.proteinG, carbsG: targets.carbsG, fatG: targets.fatG },
      {
        kcal: selection.winner.kcal,
        proteinG: selection.winner.proteinG,
        carbsG: selection.winner.carbsG,
        fatG: selection.winner.fatG,
      },
    );

    return {
      recipeId: selection.winner.id,
      recipeName: selection.winner.name,
      portionMultiplier,
      score: selection.score,
      reasons: selection.reasons,
      rejectedCandidates: selection.rejectedCandidates,
      constraintsApplied: selection.constraintsApplied,
    };
  }
}

let cached: DecisionEngine | null = null;

export function getDecisionEngine(): DecisionEngine {
  if (!cached) cached = new MultiFactorDecisionEngine();
  return cached;
}
