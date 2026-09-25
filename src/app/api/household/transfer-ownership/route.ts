import { NextResponse } from "next/server";
import { getCurrentHouseholdContext } from "@/lib/household/context";
import { transferOwnership } from "@/lib/household/householdService";
import { transferOwnershipSchema } from "@/lib/validation/household";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

export async function POST(request: Request) {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Nur der Owner kann die Eigentümerschaft übertragen." }, { status: 403 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = transferOwnershipSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const result = await transferOwnership(ctx.householdId, ctx.memberId, parsed.data.targetMemberId);
  if (!result.ok) {
    if (result.error === "SELF") return NextResponse.json({ error: "Du bist bereits Owner." }, { status: 400 });
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
