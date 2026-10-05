import { NextResponse } from "next/server";
import { parseCalendarDate, todayForUser } from "@/lib/calendarDate";
import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import { isBeyondAutomaticPlanningHorizon } from "@/lib/planDayBoundary";
import { requireApiProfileId } from "@/lib/apiProfile";
import { getApiUserId } from "@/lib/session";

/**
 * `?date=JJJJ-MM-TT` ist ein Kalendertag des Nutzers; ohne Angabe gilt heute. Für einen vergangenen
 * Tag ohne gespeicherten Plan ist `plan` null - er wird nicht nachträglich erzeugt (R5E). Ein Tag hinter
 * dem Planungshorizont (planDayBoundary.ts, R5F-13) wird ebenfalls nicht erzeugt: Ein gespeicherter Plan
 * kommt unverändert zurück, ohne gespeicherten Plan antwortet die Route mit 400.
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const today = todayForUser();
  const day = dateParam ? parseCalendarDate(dateParam) : today;
  if (!day) return NextResponse.json({ error: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." }, { status: 400 });

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  const plan = await getOrGenerateDayPlan(profileId, day, today);
  if (!plan && isBeyondAutomaticPlanningHorizon(day, today)) {
    return NextResponse.json({ error: "Dieser Tag liegt außerhalb des aktuellen Planungshorizonts." }, { status: 400 });
  }
  return NextResponse.json({ plan });
}
