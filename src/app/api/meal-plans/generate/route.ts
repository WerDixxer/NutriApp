import { NextResponse } from "next/server";
import { getApiHouseholdId } from "@/lib/session";
import { prisma } from "@/lib/db";
import { generateAndSaveMealPlan } from "@/lib/mealPlanner/generate";
import { generateMealPlanSchema } from "@/lib/validation/mealPlan";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

/**
 * Erzeugt und speichert einen Meal Plan (Abschnitt 17/22): Session prüfen,
 * Household serverseitig bestimmen, Input validieren, `memberIds` (falls
 * angegeben) explizit gegen die tatsächliche Mitgliederliste DIESES
 * Haushalts prüfen (nie vertrauen), dann deterministisch planen und
 * speichern.
 */
export async function POST(request: Request) {
  const householdId = await getApiHouseholdId();
  if (!householdId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = generateMealPlanSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const input = parsed.data;

  let householdMemberIds: string[] | null = null;
  if (input.memberIds && input.memberIds.length > 0) {
    const validMembers = await prisma.householdMember.findMany({
      where: { householdId, id: { in: input.memberIds } },
      select: { id: true },
    });
    const validIds = new Set(validMembers.map((m) => m.id));
    const invalid = input.memberIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      return NextResponse.json({ error: "Mindestens eine angegebene memberId gehört nicht zu deinem Haushalt." }, { status: 400 });
    }
    householdMemberIds = input.memberIds;
  }

  const result = await generateAndSaveMealPlan({
    householdId,
    householdMemberIds,
    startDate: input.startDate,
    days: input.days,
    slots: input.mealTypes,
    name: input.name,
  });

  if (result.status === "NO_VALID_PLAN") {
    return NextResponse.json(
      {
        status: result.status,
        plan: null,
        unmetSlots: result.unmetSlots,
        message:
          "Für diese Kombination aus Allergien, Zielen und verfügbaren Rezepten konnte kein vollständiger Plan erstellt werden.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ status: result.status, plan: result.plan, unmetSlots: result.unmetSlots });
}
