import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { getBudgetSummary } from "@/lib/budget/budgetService";

export async function GET() {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const summary = await getBudgetSummary(householdId);
  return NextResponse.json({ summary });
}
