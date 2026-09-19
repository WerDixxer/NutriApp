import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { listBudgets, setBudget } from "@/lib/budget/budgetService";
import { setBudgetSchema } from "@/lib/validation/budget";
import { firstZodIssue } from "@/lib/validation/zodError";

export async function GET() {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const budgets = await listBudgets(householdId);
  return NextResponse.json({ budgets });
}

/** "Budget setzen": legt für periodType an oder ersetzt den Betrag (siehe @@unique in schema.prisma). */
export async function POST(request: Request) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const parsed = setBudgetSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const budget = await setBudget(householdId, parsed.data);
  return NextResponse.json({ budget });
}
