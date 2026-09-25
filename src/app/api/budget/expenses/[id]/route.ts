import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { deleteExpense, updateExpense } from "@/lib/budget/budgetService";
import { updateExpenseSchema } from "@/lib/validation/budget";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = updateExpenseSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const expense = await updateExpense(householdId, id, parsed.data);
  if (!expense) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ expense });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const deleted = await deleteExpense(householdId, id);
  if (!deleted) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
