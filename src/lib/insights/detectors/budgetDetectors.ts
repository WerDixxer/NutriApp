import { formatCents } from "../../budget/money";
import type { Insight } from "../types";

export interface BudgetInsightEntry {
  budgetId: string;
  periodType: "WEEK" | "MONTH";
  currency: string;
  spentAmountCents: number;
  remainingAmountCents: number;
  spentPercentage: number;
  status: "UNDER_BUDGET" | "NEAR_LIMIT" | "OVER_BUDGET";
  periodStart: Date;
}

/** Zusammengesetztes Nomen statt Adjektiv-Flexion von BUDGET_PERIOD_LABELS
 *  ("Woche" -> "wöchentlich" lässt sich nicht durch simples toLowerCase()
 *  ableiten) - eigene, absichtlich kleine Wortliste nur für diese zwei Fälle. */
const PERIOD_NOUN: Record<"WEEK" | "MONTH", string> = { WEEK: "Wochenbudget", MONTH: "Monatsbudget" };

/**
 * Reine Weiterverarbeitung von calculateBudgetStatus() (budget/budgetCalculation.ts) -
 * keine eigene Schwellenwert-Logik, nur eine Übersetzung des bereits
 * berechneten Status in einen Satz. Der Perioden-Start ist Teil der id: eine
 * neue Woche/ein neuer Monat ist eine neue Tatsache, eine alte Ablehnung darf
 * sie nicht unterdrücken.
 */
export function detectBudgetInsights(entries: BudgetInsightEntry[], now: Date = new Date()): Insight[] {
  const insights: Insight[] = [];

  for (const entry of entries) {
    const periodNoun = PERIOD_NOUN[entry.periodType];
    const periodKey = entry.periodStart.toISOString().slice(0, 10);

    if (entry.status === "OVER_BUDGET") {
      const over = formatCents(Math.abs(entry.remainingAmountCents), entry.currency);
      insights.push({
        id: `budget:over:${entry.budgetId}:${periodKey}`,
        type: "BUDGET_OVER",
        category: "BUDGET",
        priority: "important",
        message: `Du liegst ${over} über deinem ${periodNoun}.`,
        context: { budgetId: entry.budgetId, periodType: entry.periodType, overAmountCents: Math.abs(entry.remainingAmountCents) },
        source: { entity: "FoodBudget", id: entry.budgetId },
        surfaces: ["DASHBOARD", "BUDGET"],
        action: { label: "Budget ansehen", href: "/budget" },
        detectedAt: now,
        expiresAt: null,
      });
      continue;
    }

    if (entry.status === "NEAR_LIMIT") {
      const remaining = formatCents(entry.remainingAmountCents, entry.currency);
      insights.push({
        id: `budget:near-limit:${entry.budgetId}:${periodKey}`,
        type: "BUDGET_NEAR_LIMIT",
        category: "BUDGET",
        priority: "useful",
        message: `Du näherst dich deinem ${periodNoun}, noch ${remaining} übrig.`,
        context: { budgetId: entry.budgetId, periodType: entry.periodType, remainingAmountCents: entry.remainingAmountCents },
        source: { entity: "FoodBudget", id: entry.budgetId },
        surfaces: ["DASHBOARD", "BUDGET"],
        action: { label: "Budget ansehen", href: "/budget" },
        detectedAt: now,
        expiresAt: null,
      });
      continue;
    }

    // UNDER_BUDGET: nur melden, wenn tatsächlich schon etwas erfasst wurde -
    // "du bist unter dem Budget" ist bei 0€ Ausgaben trivial wahr und damit
    // keine echte Information (Kapitel-Auftrag Abschnitt 16).
    if (entry.spentAmountCents > 0) {
      const remaining = formatCents(entry.remainingAmountCents, entry.currency);
      insights.push({
        id: `budget:under-with-room:${entry.budgetId}:${periodKey}`,
        type: "BUDGET_UNDER_WITH_ROOM",
        category: "BUDGET",
        priority: "informational",
        message: `Du bist noch ${remaining} unter deinem ${periodNoun}.`,
        context: { budgetId: entry.budgetId, periodType: entry.periodType, remainingAmountCents: entry.remainingAmountCents },
        source: { entity: "FoodBudget", id: entry.budgetId },
        surfaces: ["DASHBOARD", "BUDGET"],
        action: { label: "Budget ansehen", href: "/budget" },
        detectedAt: now,
        expiresAt: null,
      });
    }
  }

  return insights;
}
