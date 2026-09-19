export type BudgetStatus = "UNDER_BUDGET" | "NEAR_LIMIT" | "OVER_BUDGET";

/** Zentral definierter Schwellenwert, siehe rotation/weights.ts für dasselbe Muster. */
export const BUDGET_STATUS_THRESHOLDS = {
  /** Ab diesem Anteil des Budgets (0..1) gilt der Status als NEAR_LIMIT statt UNDER_BUDGET. */
  nearLimitRatio: 0.8,
} as const;

export interface BudgetCalculationResult {
  budgetAmountCents: number;
  spentAmountCents: number;
  remainingAmountCents: number;
  /** Kann > 100 gehen (Overspend). */
  spentPercentage: number;
  /** Kann negativ werden (Overspend). */
  remainingPercentage: number;
  periodStart: Date;
  periodEnd: Date;
  status: BudgetStatus;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Reine Domain-Funktion: keine Bewertung des Nutzers, keine Empfehlung,
 * nur eine faktische Einordnung (UNDER_BUDGET/NEAR_LIMIT/OVER_BUDGET). Ein
 * Budget von 0 mit 0 Ausgaben gilt als UNDER_BUDGET (kein künstlicher
 * Grenzfall), ein Budget von 0 mit jeder Ausgabe > 0 sofort als OVER_BUDGET.
 */
export function calculateBudgetStatus(
  budgetAmountCents: number,
  spentAmountCents: number,
  periodStart: Date,
  periodEnd: Date,
): BudgetCalculationResult {
  const remainingAmountCents = budgetAmountCents - spentAmountCents;
  const ratio = budgetAmountCents > 0 ? spentAmountCents / budgetAmountCents : spentAmountCents > 0 ? Infinity : 0;

  const spentPercentage = round2(ratio === Infinity ? 100 : ratio * 100);
  const remainingPercentage = budgetAmountCents > 0 ? round2((remainingAmountCents / budgetAmountCents) * 100) : 0;

  let status: BudgetStatus;
  if (spentAmountCents > budgetAmountCents) status = "OVER_BUDGET";
  else if (ratio >= BUDGET_STATUS_THRESHOLDS.nearLimitRatio) status = "NEAR_LIMIT";
  else status = "UNDER_BUDGET";

  return { budgetAmountCents, spentAmountCents, remainingAmountCents, spentPercentage, remainingPercentage, periodStart, periodEnd, status };
}
