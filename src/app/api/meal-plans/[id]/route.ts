import { NextResponse } from "next/server";
import { todayForUser } from "@/lib/calendarDate";
import { getApiHouseholdId } from "@/lib/session";
import { deleteMealPlan, getMealPlan, updateMealPlan, type MealPlanUpdateError } from "@/lib/mealPlanner/mealPlanService";
import { updateMealPlanSchema } from "@/lib/validation/mealPlan";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

type RouteContext = { params: Promise<{ id: string }> };

/** Antworten für abgelehnte Änderungen (Lebenszyklus siehe mealPlanner/planLifecycle.ts). */
const UPDATE_ERRORS: Record<MealPlanUpdateError, { status: number; error: string }> = {
  NOT_FOUND: { status: 404, error: "Nicht gefunden." },
  INVALID_TRANSITION: { status: 409, error: "Dieser Statuswechsel ist nicht möglich: Entwürfe können aktiviert, aktive Pläne archiviert werden." },
  HISTORICAL_PLAN: { status: 409, error: "Ein vergangener Entwurf kann nicht mehr aktiviert werden." },
};

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
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = updateMealPlanSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const result = await updateMealPlan(householdId, id, parsed.data, todayForUser());
  if (!result.ok) {
    const { status, error } = UPDATE_ERRORS[result.error];
    return NextResponse.json({ error }, { status });
  }
  return NextResponse.json({ plan: result.plan, archivedPlanIds: result.archivedPlanIds });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteMealPlan(householdId, id, todayForUser());
  if (!deleted.ok && deleted.error === "NOT_FOUND") return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  if (!deleted.ok) {
    return NextResponse.json(
      { error: "Löschen lassen sich nur Entwürfe, die heute oder später beginnen; aktive, archivierte und vergangene Pläne bleiben erhalten." },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}
