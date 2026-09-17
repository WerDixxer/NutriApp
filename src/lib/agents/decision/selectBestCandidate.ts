import type { SearchableRecipe } from "../recipeSearch";
import { buildConstraintsAppliedList, checkHardConstraints, type HardConstraintContext } from "./hardConstraints";
import { scoreCandidate, type ScoringContext } from "./softScoring";

export interface RejectedCandidate {
  recipeId: string;
  name: string;
  reason: string;
}

export interface SelectionResult {
  winner: SearchableRecipe;
  score: number;
  reasons: string[];
  rejectedCandidates: RejectedCandidate[];
  constraintsApplied: string[];
}

/**
 * Reine, deterministische Kernfunktion der Decision Engine, ohne DB-/LLM-
 * Zugriff (dafür vollständig unit-testbar): Kandidaten -> harte Ausschlüsse
 * -> Scoring der verbleibenden -> beste Option. Hard Constraints eliminieren
 * vollständig, ein Kandidat mit Verstoß kann also nie gewinnen, unabhängig
 * vom Score. Bei Score-Gleichstand entscheidet die Recipe-ID (aufsteigend)
 * für ein deterministisches, reproduzierbares Ergebnis.
 */
export function selectBestCandidate(
  candidates: SearchableRecipe[],
  hardCtx: HardConstraintContext,
  scoringCtx: ScoringContext,
): SelectionResult | null {
  const constraintsApplied = buildConstraintsAppliedList(hardCtx);

  const evaluated = candidates.map((candidate) => ({
    candidate,
    violations: checkHardConstraints(candidate, hardCtx),
  }));

  const eligible = evaluated.filter((e) => e.violations.length === 0);
  if (eligible.length === 0) return null;

  const rejectedCandidates: RejectedCandidate[] = evaluated
    .filter((e) => e.violations.length > 0)
    .map((e) => ({
      recipeId: e.candidate.id,
      name: e.candidate.name,
      reason: e.violations.map((v) => v.detail).join(" "),
    }));

  const scored = eligible.map((e) => ({ candidate: e.candidate, ...scoreCandidate(e.candidate, scoringCtx) }));
  scored.sort((a, b) => b.total - a.total || a.candidate.id.localeCompare(b.candidate.id));

  const winner = scored[0];
  const reasons = winner.factorResults.filter((f): f is typeof f & { reason: string } => !!f.reason).map((f) => f.reason);

  return {
    winner: winner.candidate,
    score: Math.round(winner.total * 1000) / 1000,
    reasons,
    rejectedCandidates,
    constraintsApplied,
  };
}
