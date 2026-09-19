import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { createExpense, listExpenses } from "@/lib/budget/budgetService";
import { createExpenseSchema, expenseRangeQuerySchema } from "@/lib/validation/budget";
import { firstZodIssue } from "@/lib/validation/zodError";

export async function GET(request: Request) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = expenseRangeQuerySchema.safeParse({
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const expenses = await listExpenses(householdId, parsed.data);
  return NextResponse.json({ expenses });
}

export async function POST(request: Request) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const parsed = createExpenseSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const expense = await createExpense(householdId, parsed.data);
  return NextResponse.json({ expense });
}
