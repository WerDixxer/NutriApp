import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { listMealPlans } from "@/lib/mealPlanner/mealPlanService";

export async function GET() {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const plans = await listMealPlans(householdId);
  return NextResponse.json({ plans });
}
