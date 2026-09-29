import { NextResponse } from "next/server";
import { todayForUser } from "@/lib/calendarDate";
import { prisma } from "@/lib/db";
import { regenerateEditableDays } from "@/lib/generateMealPlan";
import { getApiUserId } from "@/lib/session";

/**
 * Plant heute und alle bereits gespeicherten künftigen Tagespläne des angemeldeten Profils mit dem
 * aktuellen Profil neu (R5E). Ausdrückliche Aktion, keine Eingaben: "heute" bestimmt allein der
 * Server (`todayForUser`), ein Body oder Query-Parameter wird nicht gelesen - vergangene Tage lassen
 * sich darüber nicht ansprechen.
 */
export async function POST() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });

  const today = todayForUser();
  const { regeneratedDays } = await regenerateEditableDays(profile.id, today);
  return NextResponse.json({ today, regeneratedDays });
}
