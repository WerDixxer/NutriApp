import type { BudgetPeriodType } from "@prisma/client";
import { prisma } from "../db";
import { eurosToCents } from "./money";
import { getCurrentPeriodBounds } from "./period";
import { calculateBudgetStatus, type BudgetCalculationResult } from "./budgetCalculation";
import type { CreateExpenseInput, SetBudgetInput, UpdateBudgetInput, UpdateExpenseInput } from "../validation/budget";

/**
 * Wie pantryService.ts: JEDE Query/jeder Write ist nach `householdId`
 * gefiltert (nie nach `id` allein), damit eine erratene/fremde ID
 * konsequent zu "nicht gefunden" statt zum Datensatz eines anderen
 * Haushalts führt.
 */

export function listBudgets(householdId: string) {
  return prisma.foodBudget.findMany({ where: { householdId }, orderBy: { periodType: "asc" } });
}

/** "Budget setzen": legt für (householdId, periodType) an oder ersetzt den Betrag, siehe @@unique in schema.prisma. */
export function setBudget(householdId: string, input: SetBudgetInput) {
  const amountCents = eurosToCents(input.amount);
  return prisma.foodBudget.upsert({
    where: { householdId_periodType: { householdId, periodType: input.periodType } },
    create: { householdId, periodType: input.periodType, amountCents, currency: input.currency },
    update: { amountCents, currency: input.currency },
  });
}

export async function updateBudgetAmount(householdId: string, id: string, input: UpdateBudgetInput) {
  const existing = await prisma.foodBudget.findFirst({ where: { id, householdId } });
  if (!existing) return null;
  return prisma.foodBudget.update({ where: { id }, data: { amountCents: eurosToCents(input.amount) } });
}

export async function deleteBudget(householdId: string, id: string): Promise<boolean> {
  const result = await prisma.foodBudget.deleteMany({ where: { id, householdId } });
  return result.count > 0;
}

export interface ExpenseRange {
  from?: Date;
  to?: Date;
}

export function listExpenses(householdId: string, range: ExpenseRange = {}) {
  return prisma.foodExpense.findMany({
    where: {
      householdId,
      ...(range.from || range.to
        ? { date: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
        : {}),
    },
    orderBy: { date: "desc" },
    take: 200,
  });
}

export function createExpense(householdId: string, input: CreateExpenseInput) {
  return prisma.foodExpense.create({
    data: {
      householdId,
      amountCents: eurosToCents(input.amount),
      currency: input.currency,
      date: input.date,
      category: input.category,
      source: input.source,
      description: input.description,
    },
  });
}

export async function updateExpense(householdId: string, id: string, input: UpdateExpenseInput) {
  const existing = await prisma.foodExpense.findFirst({ where: { id, householdId } });
  if (!existing) return null;
  return prisma.foodExpense.update({
    where: { id },
    data: {
      amountCents: eurosToCents(input.amount),
      currency: input.currency,
      date: input.date,
      category: input.category,
      source: input.source ?? null,
      description: input.description ?? null,
    },
  });
}

export async function deleteExpense(householdId: string, id: string): Promise<boolean> {
  const result = await prisma.foodExpense.deleteMany({ where: { id, householdId } });
  return result.count > 0;
}

export interface BudgetSummaryEntry extends BudgetCalculationResult {
  budgetId: string;
  periodType: BudgetPeriodType;
  currency: string;
}

/**
 * Eine einzige Ausgaben-Query für alle vorhandenen Budgets (nicht eine pro
 * Periodentyp): die weiteste benötigte Zeitspanne wird einmal geladen,
 * die einzelnen Perioden-Summen werden danach im Speicher gebildet. Gleiches
 * Muster wie getPantryContextForHousehold() in rotation/rotationService.ts.
 */
export async function getBudgetSummary(householdId: string, now: Date = new Date()): Promise<BudgetSummaryEntry[]> {
  const budgets = await listBudgets(householdId);
  if (budgets.length === 0) return [];

  const bounds = budgets.map((b) => ({ budget: b, ...getCurrentPeriodBounds(b.periodType, now) }));
  const earliestStart = new Date(Math.min(...bounds.map((b) => b.start.getTime())));
  const latestEnd = new Date(Math.max(...bounds.map((b) => b.end.getTime())));

  const expenses = await prisma.foodExpense.findMany({
    where: { householdId, date: { gte: earliestStart, lte: latestEnd } },
    select: { amountCents: true, date: true },
  });

  return bounds.map(({ budget, start, end }) => {
    const spentAmountCents = expenses
      .filter((e) => e.date >= start && e.date <= end)
      .reduce((sum, e) => sum + e.amountCents, 0);
    const calc = calculateBudgetStatus(budget.amountCents, spentAmountCents, start, end);
    return { ...calc, budgetId: budget.id, periodType: budget.periodType, currency: budget.currency };
  });
}
