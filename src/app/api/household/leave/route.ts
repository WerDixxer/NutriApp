import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { leaveHousehold } from "@/lib/household/householdService";

export async function POST() {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const result = await leaveHousehold(ctx.householdId, ctx.memberId, ctx.role);
  if (result.type === "OWNER_MUST_TRANSFER_FIRST") {
    return NextResponse.json(
      { error: "Als Owner musst du zuerst die Eigentümerschaft übertragen, bevor du den Haushalt verlassen kannst." },
      { status: 409 },
    );
  }

  return NextResponse.json({ dissolved: result.type === "DISSOLVED" });
}
