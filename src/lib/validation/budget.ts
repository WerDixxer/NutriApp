import { z } from "zod";

export const currencySchema = z.enum(["EUR"]);
export const budgetPeriodTypeSchema = z.enum(["WEEK", "MONTH"]);
export const foodExpenseCategorySchema = z.enum(["GROCERIES", "RESTAURANT", "TAKEAWAY", "OTHER"]);

// Client schickt Euro als Dezimalzahl (z.B. 19.87), serverseitig deterministisch
// in Cent umgerechnet (siehe budget/money.ts), nie als Float weitergereicht.
// max(100000): realistische Obergrenze gegen Fehleingaben, kein künstliches Mikro-Limit.
const moneyAmountSchema = z.number().positive("Betrag muss größer als 0 sein.").max(100000, "Betrag ist unrealistisch hoch.");

export const setBudgetSchema = z.object({
  periodType: budgetPeriodTypeSchema,
  amount: moneyAmountSchema,
  currency: currencySchema.default("EUR"),
});

export const updateBudgetSchema = z.object({
  amount: moneyAmountSchema,
});

export const createExpenseSchema = z.object({
  amount: moneyAmountSchema,
  currency: currencySchema.default("EUR"),
  date: z.coerce.date(),
  category: foodExpenseCategorySchema.default("GROCERIES"),
  source: z.string().trim().max(120).optional(),
  description: z.string().trim().max(200).optional(),
});

export const updateExpenseSchema = createExpenseSchema;

export const expenseRangeQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type SetBudgetInput = z.infer<typeof setBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
