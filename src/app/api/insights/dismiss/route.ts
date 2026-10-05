import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiProfileId } from "@/lib/apiProfile";
import { getApiUserId } from "@/lib/session";
import { dismissInsightSchema } from "@/lib/validation/insights";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

/**
 * Merkt sich, dass DIESES Profil dieses eine Insight (per stabiler id, siehe
 * insights/types.ts) nicht mehr sehen möchte. Erzeugt niemals ein "gelöst"-
 * Signal - das ergibt sich von selbst, sobald die zugrunde liegende Regel
 * beim nächsten Aufruf nicht mehr zutrifft (siehe DismissedInsight-Kommentar
 * in schema.prisma). `upsert` statt `create`: ein zweites Abweisen derselben
 * id ist kein Fehler, nur ein aktualisiertes Datum.
 */
export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = dismissInsightSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  await prisma.dismissedInsight.upsert({
    where: { profileId_insightKey: { profileId, insightKey: parsed.data.insightKey } },
    create: { profileId, insightKey: parsed.data.insightKey },
    update: { dismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
