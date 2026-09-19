import { NextResponse } from "next/server";
import { getApiUserId } from "@/lib/session";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { createSoloHousehold, getHousehold, updateHousehold } from "@/lib/household/householdService";
import { prisma } from "@/lib/db";
import { updateHouseholdSchema } from "@/lib/validation/household";
import { firstZodIssue } from "@/lib/validation/zodError";

export async function GET() {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const household = await getHousehold(ctx.householdId);
  if (!household) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ household, role: ctx.role });
}

/**
 * Legt einen neuen, eigenen Haushalt an - nur für User, die aktuell KEINEM
 * Haushalt angehören (z.B. nach leaveHousehold()/Entfernung). Reine
 * Wiederverwendung von createSoloHousehold() (auch von registerAction()
 * genutzt), keine neue Logik. Ein User mit bestehendem Haushalt bekommt 409,
 * nie eine zweite Mitgliedschaft (HouseholdMember.userId ist unique).
 */
export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const existing = await prisma.householdMember.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return NextResponse.json({ error: "Du gehörst bereits einem Haushalt an." }, { status: 409 });

  const parsed = updateHouseholdSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const household = await createSoloHousehold(userId, parsed.data.name);
  return NextResponse.json({ household });
}

/** Haushaltseinstellungen (Name, Währung) ändern - nur OWNER, serverseitig geprüft (nicht nur in der UI versteckt). */
export async function PATCH(request: Request) {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann den Haushalt bearbeiten." }, { status: 403 });

  const parsed = updateHouseholdSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const household = await updateHousehold(ctx.householdId, parsed.data);
  return NextResponse.json({ household });
}
