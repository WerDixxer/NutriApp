import type { MacroDeviation } from "./loss";
import type { MacroTolerances } from "./tolerances";
import type { RejectedCandidate } from "../decision/selectBestCandidate";

export interface MacroRescueTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
}

export interface MacroRescueActual {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MacroRescueSolution {
  recipeId: string;
  recipeName: string;
  portionMultiplier: number;
  actual: MacroRescueActual;
  totalLoss: number;
  deviations: MacroDeviation[];
  explanation: string;
}

export interface MacroRescueResult {
  targets: MacroRescueTargets;
  tolerances: MacroTolerances;
  /** Beste zuerst (aufsteigend nach totalLoss). */
  solutions: MacroRescueSolution[];
  rejectedCandidates: RejectedCandidate[];
  constraintsApplied: string[];
}
