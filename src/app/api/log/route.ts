import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import type { MealSlot } from "@prisma/client";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const date = startOfDay(dateParam ? new Date(dateParam) : new Date());

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ entries: [] });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ entries: [] });

  const entries = await prisma.logEntry.findMany({
    where: { profileId: profile.id, date },
    include: { recipe: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ entries });
}

interface LogPayload {
  date: string;
  slot: MealSlot;
  recipeId?: string;
  customName?: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export async function POST(request: Request) {
  const body = (await request.json()) as LogPayload;

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  const entry = await prisma.logEntry.create({
    data: {
      profileId: profile.id,
      date: startOfDay(new Date(body.date)),
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
