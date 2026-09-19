import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { removeMember } from "@/lib/household/householdService";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Mitglied entfernen - nur OWNER. Bewusst kein Weg, sich selbst hierüber zu
 * entfernen oder den OWNER zu entfernen (siehe removeMember()); dafür gibt es
 * /api/household/leave und /api/household/transfer-ownership.
 */
export async function DELETE(_request: Request, { params }: RouteContext) {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann Mitglieder entfernen." }, { status: 403 });

  const { id } = await params;
  if (id === ctx.memberId) {
    return NextResponse.json({ error: "Nutze /api/household/leave, um den Haushalt selbst zu verlassen." }, { status: 400 });
  }

  const result = await removeMember(ctx.householdId, id);
  if (!result.ok) {
    if (result.error === "NOT_FOUND") return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    return NextResponse.json({ error: "Der Owner kann nicht entfernt werden. Zuerst Eigentümerschaft übertragen." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
