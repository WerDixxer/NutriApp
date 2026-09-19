import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { deleteBudget, updateBudgetAmount } from "@/lib/budget/budgetService";
import { updateBudgetSchema } from "@/lib/validation/budget";
import { firstZodIssue } from "@/lib/validation/zodError";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const parsed = updateBudgetSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const budget = await updateBudgetAmount(householdId, id, parsed.data);
  if (!budget) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ budget });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteBudget(householdId, id);
  if (!deleted) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
