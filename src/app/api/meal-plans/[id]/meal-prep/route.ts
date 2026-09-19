import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { analyzeMealPrep } from "@/lib/mealPrep/mealPrepService";
import { mealPrepQuerySchema } from "@/lib/validation/mealPrep";
import { firstZodIssue } from "@/lib/validation/zodError";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Read-only (Abschnitt 25: keine Apply-Funktion, nur Analyse). `id` ist die
 * mealPlanId, householdId kommt ausschließlich aus der Session - ein
 * fremder/erratener Plan liefert 404, nie Daten eines anderen Haushalts
 * (siehe mealPrepService.ts -> getMealPlan()).
 */
export async function GET(request: Request, { params }: RouteContext) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = mealPrepQuerySchema.safeParse({ strategy: searchParams.get("strategy") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const { id } = await params;
  const result = await analyzeMealPrep(householdId, id, parsed.data.strategy);
  if (!result) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ mealPrep: result });
}
