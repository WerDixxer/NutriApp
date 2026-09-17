import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { adjustPantryItemQuantity } from "@/lib/pantry/pantryService";
import { adjustPantryQuantitySchema } from "@/lib/validation/pantry";
import { firstZodIssue } from "@/lib/validation/zodError";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Einziger Weg, `remainingQuantity` zu ändern (Zu-/Abgänge), damit keine
 * andere Route eine eigene Mengenberechnung erfindet, siehe
 * src/lib/pantry/adjustQuantity.ts.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const parsed = adjustPantryQuantitySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const item = await adjustPantryItemQuantity(householdId, id, parsed.data);
  if (!item) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ item });
}
