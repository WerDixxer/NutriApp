import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { getHouseholdRotation } from "@/lib/rotation/rotationService";

/**
 * Kein Client-Input zu validieren (nur die Session entscheidet den
 * Haushalt), deshalb kein zod-Schema nötig. `householdId` kommt
 * ausschließlich aus `getApiHouseholdId()`, nie aus Query/Body.
 */
export async function GET() {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const rotation = await getHouseholdRotation(householdId);
  return NextResponse.json(rotation);
}
