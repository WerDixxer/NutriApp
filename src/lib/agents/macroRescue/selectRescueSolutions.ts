import type { SearchableRecipe } from "../recipeSearch";
import { buildConstraintsAppliedList, checkHardConstraints, type HardConstraintContext } from "../decision/hardConstraints";
import type { RejectedCandidate } from "../decision/selectBestCandidate";
import { hasValidCoreNutrition } from "./candidateValidation";
import { computeMacroLoss } from "./loss";
import type { MacroLossWeights } from "./lossWeights";
import { findOptimalPortion } from "./portionOptimizer";
import type { MacroTolerances } from "./tolerances";
import { buildRescueExplanation } from "./explanation";
import type { MacroRescueSolution, MacroRescueTargets } from "./types";

export interface SelectRescueSolutionsResult {
  solutions: MacroRescueSolution[];
  rejectedCandidates: RejectedCandidate[];
  constraintsApplied: string[];
}

/**
 * Reine, deterministische Kernfunktion (kein DB-/LLM-Zugriff): Kandidaten ->
 * Hard Constraints (Allergien/Dietary Style/Ausschlüsse, wiederverwendet aus
 * der Decision Engine, plus Nutrition-Daten-Validität) -> pro verbleibendem
 * Kandidaten die Portionsgröße finden, die den Loss minimiert -> Ergebnisse
 * aufsteigend nach Loss sortiert. Deviations/Erklärung werden aus den
 * GERUNDETEN, tatsächlich angezeigten Ist-Werten neu berechnet, damit Text
 * und Zahlen exakt zusammenpassen.
 */
export function selectRescueSolutions(
  candidates: SearchableRecipe[],
  hardCtx: HardConstraintContext,
  targets: MacroRescueTargets,
  tolerances: MacroTolerances,
  weights: MacroLossWeights,
  limit: number,
): SelectRescueSolutionsResult {
  const constraintsApplied = buildConstraintsAppliedList(hardCtx);
  const rejectedCandidates: RejectedCandidate[] = [];
  const evaluable: SearchableRecipe[] = [];

  for (const candidate of candidates) {
    const violations = checkHardConstraints(candidate, hardCtx);
    if (violations.length > 0) {
      rejectedCandidates.push({
        recipeId: candidate.id,
        name: candidate.name,
        reason: violations.map((v) => v.detail).join(" "),
      });
      continue;
    }
    if (!hasValidCoreNutrition(candidate)) {
      rejectedCandidates.push({
        recipeId: candidate.id,
        name: candidate.name,
        reason: "Unvollständige oder ungültige Nährwertdaten, nicht bewertbar.",
      });
      continue;
    }
    evaluable.push(candidate);
  }

  const solutions: MacroRescueSolution[] = evaluable.map((candidate) => {
    const base = { calories: candidate.kcal, protein: candidate.proteinG, carbs: candidate.carbsG, fat: candidate.fatG };
    const portionMultiplier = findOptimalPortion(base, targets, tolerances, weights);

    const actual = {
      calories: Math.round(candidate.kcal * portionMultiplier),
      protein: Math.round(candidate.proteinG * portionMultiplier * 10) / 10,
      carbs: Math.round(candidate.carbsG * portionMultiplier * 10) / 10,
      fat: Math.round(candidate.fatG * portionMultiplier * 10) / 10,
    };

    // Deviations/Loss aus den gerundeten Ist-Werten, damit Explainability-Text
    // und -Zahlen exakt zu dem passen, was tatsächlich angezeigt wird.
    const { totalLoss, deviations } = computeMacroLoss(targets, actual, tolerances, weights);

    return {
      recipeId: candidate.id,
      recipeName: candidate.name,
      portionMultiplier,
      actual,
      totalLoss: Math.round(totalLoss * 1000) / 1000,
      deviations,
      explanation: buildRescueExplanation(candidate.name, portionMultiplier, actual, deviations),
    };
  });

  solutions.sort((a, b) => a.totalLoss - b.totalLoss || a.recipeId.localeCompare(b.recipeId));

  return { solutions: solutions.slice(0, limit), rejectedCandidates, constraintsApplied };
}
