import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { createInvite, listPendingInvites } from "@/lib/household/inviteService";
import { createInviteSchema } from "@/lib/validation/household";
import { firstZodIssue } from "@/lib/validation/zodError";

export async function GET() {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann Einladungen sehen." }, { status: 403 });

  const invites = await listPendingInvites(ctx.householdId);
  return NextResponse.json({ invites });
}

/** Erzeugt eine Einladung - nur OWNER. Der Roh-Token kommt genau einmal in dieser Antwort zurück, siehe inviteService.ts. */
export async function POST(request: Request) {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann einladen." }, { status: 403 });

  const parsed = createInviteSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const result = await createInvite(ctx.householdId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: "Für diese E-Mail existiert bereits eine offene Einladung." }, { status: 409 });
  }

  return NextResponse.json({
    inviteId: result.inviteId,
    token: result.token,
    expiresAt: result.expiresAt,
    inviteUrl: `/invite/${result.token}`,
  });
}
