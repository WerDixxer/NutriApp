import { describe, expect, it, vi } from "vitest";
import { DELETE_BUDGET_FAILED_MESSAGE, DELETE_EXPENSE_FAILED_MESSAGE, deleteBudget, deleteExpense } from "./budgetRequests";

const respond = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);
const offline = () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

describe.each([
  ["deleteBudget", deleteBudget, "/api/budget/budget-1", DELETE_BUDGET_FAILED_MESSAGE],
  ["deleteExpense", deleteExpense, "/api/budget/expenses/budget-1", DELETE_EXPENSE_FAILED_MESSAGE],
] as const)("%s (R5F-3)", (_name, remove, url, failedMessage) => {
  it("Erfolg nur mit bestätigter Antwort", async () => {
    const fetchImpl = respond(Response.json({ ok: true }));

    expect(await remove("budget-1", fetchImpl)).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(url, { method: "DELETE" });
  });

  it.each([
    ["404", Response.json({ error: "Nicht gefunden." }, { status: 404 })],
    ["500", new Response("<html>Fehler</html>", { status: 500 })],
  ])("HTTP-Fehler %s: kein Erfolg, der Eintrag bleibt in der Anzeige", async (_label, response) => {
    expect(await remove("budget-1", respond(response))).toEqual({ ok: false, message: failedMessage });
  });

  it("Netzwerkfehler: kontrollierte Meldung statt Ausnahme", async () => {
    expect(await remove("budget-1", offline())).toEqual({ ok: false, message: failedMessage });
  });
});
