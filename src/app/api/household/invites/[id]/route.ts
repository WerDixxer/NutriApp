import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { revokeInvite } from "@/lib/household/inviteService";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann Einladungen zurückziehen." }, { status: 403 });

  const { id } = await params;
  const revoked = await revokeInvite(ctx.householdId, id);
  if (!revoked) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
