import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { deleteMealPlan, getMealPlan, updateMealPlan } from "@/lib/mealPlanner/mealPlanService";
import { updateMealPlanSchema } from "@/lib/validation/mealPlan";
import { firstZodIssue } from "@/lib/validation/zodError";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const plan = await getMealPlan(householdId, id);
  if (!plan) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ plan });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const parsed = updateMealPlanSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const plan = await updateMealPlan(householdId, id, parsed.data);
  if (!plan) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ plan });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteMealPlan(householdId, id);
  if (!deleted) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
