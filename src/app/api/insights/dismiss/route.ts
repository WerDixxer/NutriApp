import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { dismissInsightSchema } from "@/lib/validation/insights";
import { firstZodIssue } from "@/lib/validation/zodError";

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

  const parsed = dismissInsightSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });

  await prisma.dismissedInsight.upsert({
    where: { profileId_insightKey: { profileId: profile.id, insightKey: parsed.data.insightKey } },
    create: { profileId: profile.id, insightKey: parsed.data.insightKey },
    update: { dismissedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
