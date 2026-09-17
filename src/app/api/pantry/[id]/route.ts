import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { deletePantryItem, updatePantryItem } from "@/lib/pantry/pantryService";
import { updatePantryItemSchema } from "@/lib/validation/pantry";
import { firstZodIssue } from "@/lib/validation/zodError";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const parsed = updatePantryItemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  // updatePantryItem prüft intern erneut `id` UND `householdId` gemeinsam,
  // eine fremde ID liefert konsequent null/404, nie den Datensatz eines
  // anderen Haushalts.
  const item = await updatePantryItem(householdId, id, parsed.data);
  if (!item) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const deleted = await deletePantryItem(householdId, id);
  if (!deleted) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
