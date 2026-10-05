/**
 * Löschanfragen des Budgets, deren Ergebnis die Anzeige erst nach Bestätigung des Servers übernimmt
 * (R5F-3). HTTP- und Netzwerkfehler sind immer ein Fehler.
 */
export type BudgetRequestResult = { ok: true } | { ok: false; message: string };

export const DELETE_BUDGET_FAILED_MESSAGE = "Das Budget konnte nicht gelöscht werden. Bitte versuche es erneut.";
export const DELETE_EXPENSE_FAILED_MESSAGE = "Die Ausgabe konnte nicht gelöscht werden. Bitte versuche es erneut.";

async function confirmedDelete(url: string, failedMessage: string, fetchImpl: typeof fetch): Promise<BudgetRequestResult> {
  try {
    const res = await fetchImpl(url, { method: "DELETE" });
    return res.ok ? { ok: true } : { ok: false, message: failedMessage };
  } catch {
    return { ok: false, message: failedMessage };
  }
}

export function deleteBudget(budgetId: string, fetchImpl: typeof fetch = fetch): Promise<BudgetRequestResult> {
  return confirmedDelete(`/api/budget/${encodeURIComponent(budgetId)}`, DELETE_BUDGET_FAILED_MESSAGE, fetchImpl);
}

export function deleteExpense(expenseId: string, fetchImpl: typeof fetch = fetch): Promise<BudgetRequestResult> {
  return confirmedDelete(`/api/budget/expenses/${encodeURIComponent(expenseId)}`, DELETE_EXPENSE_FAILED_MESSAGE, fetchImpl);
}
