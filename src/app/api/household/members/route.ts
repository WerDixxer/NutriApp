import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { listMembers } from "@/lib/household/householdService";

export async function GET() {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const members = await listMembers(ctx.householdId);
  return NextResponse.json({ members, role: ctx.role, memberId: ctx.memberId });
}
