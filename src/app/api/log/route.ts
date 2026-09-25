import { NextResponse } from "next/server";
import { parseCalendarDate, todayForUser, toDbDate } from "@/lib/calendarDate";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { logPayloadSchema } from "@/lib/validation/log";
import { firstZodIssue } from "@/lib/validation/zodError";

/** `?date=JJJJ-MM-TT` ist ein Kalendertag des Nutzers; ohne Angabe gilt heute. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const day = dateParam ? parseCalendarDate(dateParam) : todayForUser();
  if (!day) return NextResponse.json({ error: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." }, { status: 400 });

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ entries: [] });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ entries: [] });

  const entries = await prisma.logEntry.findMany({
    where: { profileId: profile.id, date: toDbDate(day) },
    include: { recipe: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ entries });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const parsed = logPayloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  const entry = await prisma.logEntry.create({
    data: {
      profileId: profile.id,
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

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });

  await prisma.logEntry.deleteMany({ where: { id, profileId: profile.id } });
  return NextResponse.json({ ok: true });
}
