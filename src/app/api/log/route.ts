import { NextResponse } from "next/server";
import { parseCalendarDate, todayForUser, toDbDate } from "@/lib/calendarDate";
import { prisma } from "@/lib/db";
import { isRecipeVisibleTo, recipesVisibleTo } from "@/lib/recipes/recipeVisibility";
import { findApiProfileId, requireApiProfileId } from "@/lib/apiProfile";
import { getApiUserId } from "@/lib/session";
import { logPayloadSchema } from "@/lib/validation/log";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

/**
 * `?date=JJJJ-MM-TT` ist ein Kalendertag des Nutzers; ohne Angabe gilt heute. Ein verknüpftes Rezept
 * wird nur mitgeliefert, wenn das Profil es sehen darf (recipeVisibility.ts), sonst ist `recipe` null.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const day = dateParam ? parseCalendarDate(dateParam) : todayForUser();
  if (!day) return NextResponse.json({ error: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." }, { status: 400 });

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  // Ohne Profil gibt es keine Einträge.
  const profileId = await findApiProfileId(userId);
  if (!profileId) return NextResponse.json({ entries: [] });

  const entries = await prisma.logEntry.findMany({
    where: { profileId, date: toDbDate(day) },
    include: { recipe: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    entries: entries.map((entry) => ({
      ...entry,
      recipe: entry.recipe && isRecipeVisibleTo(entry.recipe, profileId) ? entry.recipe : null,
    })),
  });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = logPayloadSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  // Nur ein Rezept, das das Profil sehen darf. Unbekannt und fremd-privat bekommen dieselbe Antwort,
  // damit sich über diesen Endpunkt nicht prüfen lässt, ob ein fremdes Rezept existiert.
  if (body.recipeId) {
    const recipe = await prisma.recipe.findFirst({ where: { id: body.recipeId, ...recipesVisibleTo(profileId) }, select: { id: true } });
    if (!recipe) return NextResponse.json({ error: "Rezept nicht gefunden." }, { status: 404 });
  }

  const entry = await prisma.logEntry.create({
    data: {
      profileId,
      date: toDbDate(body.date),
      slot: body.slot,
      recipeId: body.recipeId,
      customName: body.customName,
      kcal: body.kcal,
      proteinG: body.proteinG,
      carbsG: body.carbsG,
      fatG: body.fatG,
    },
  });

  return NextResponse.json({ entry });
}

export async function DELETE(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  await prisma.logEntry.deleteMany({ where: { id, profileId } });
  return NextResponse.json({ ok: true });
}
