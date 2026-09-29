import { NextResponse } from "next/server";
import { parseCalendarDate, todayForUser } from "@/lib/calendarDate";
import { prisma } from "@/lib/db";
import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import { getApiUserId } from "@/lib/session";

/**
 * `?date=JJJJ-MM-TT` ist ein Kalendertag des Nutzers; ohne Angabe gilt heute. Für einen vergangenen
 * Tag ohne gespeicherten Plan ist `plan` null - er wird nicht nachträglich erzeugt (R5E).
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const today = todayForUser();
  const day = dateParam ? parseCalendarDate(dateParam) : today;
  if (!day) return NextResponse.json({ error: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." }, { status: 400 });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  const plan = await getOrGenerateDayPlan(profile.id, day, today);
  return NextResponse.json({ plan });
}
