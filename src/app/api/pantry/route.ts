import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { createPantryItem, listPantryItems } from "@/lib/pantry/pantryService";
import { createPantryItemSchema } from "@/lib/validation/pantry";
import { firstZodIssue } from "@/lib/validation/zodError";

export async function GET() {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const items = await listPantryItems(householdId);
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const parsed = createPantryItemSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const item = await createPantryItem(householdId, parsed.data);
  return NextResponse.json({ item });
}
