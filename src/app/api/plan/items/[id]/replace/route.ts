import { NextResponse } from "next/server";
import { todayForUser } from "@/lib/calendarDate";
import { replacePlannedMeal, type MealReplacementError } from "@/lib/generateMealPlan";
import { requireApiProfileId } from "@/lib/apiProfile";
import { getApiUserId } from "@/lib/session";

type RouteContext = { params: Promise<{ id: string }> };

/** Antworten für abgelehnte Ersetzungen (Regeln siehe replacePlannedMeal). */
const REPLACEMENT_ERRORS: Record<MealReplacementError, { status: number; error: string }> = {
  NOT_FOUND: { status: 404, error: "Mahlzeit nicht gefunden." },
  HISTORICAL_DAY: { status: 409, error: "Mahlzeiten vergangener Tage lassen sich nicht mehr ersetzen." },
  ALREADY_LOGGED: { status: 409, error: "Diese Mahlzeit ist bereits als gegessen eingetragen und wird nicht ersetzt." },
  NO_CANDIDATE: { status: 422, error: "Für diese Mahlzeit gibt es gerade kein anderes passendes Rezept." },
  CHANGED: { status: 409, error: "Die Mahlzeit wurde inzwischen geändert. Bitte lade den Plan neu." },
};

/**
 * Ersetzt eine einzelne geplante Mahlzeit des angemeldeten Profils (R5F-7). Keine Eingaben außer der
 * Eintrags-ID: "heute" bestimmt allein der Server (`todayForUser`), das neue Rezept der Planer.
 */
export async function POST(_request: Request, { params }: RouteContext) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  const { id } = await params;
  try {
    const result = await replacePlannedMeal(profileId, id, todayForUser());
    if (!result.ok) {
      const { status, error } = REPLACEMENT_ERRORS[result.error];
      return NextResponse.json({ error }, { status });
    }
    return NextResponse.json({ item: result.item });
  } catch (error) {
    console.error("Meal replacement failed:", error);
    return NextResponse.json({ error: "Die Mahlzeit konnte gerade nicht ersetzt werden. Versuch es nochmal." }, { status: 500 });
  }
}
