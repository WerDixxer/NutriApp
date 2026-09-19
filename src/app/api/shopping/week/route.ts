import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { getWeeklyShoppingForProfile } from "@/lib/shopping/weeklyShoppingService";
import { weeklyShoppingQuerySchema } from "@/lib/validation/shopping";
import { firstZodIssue } from "@/lib/validation/zodError";

/**
 * Read-only: Einkaufsbedarf der Woche, die `date` enthält (Standard: aktuelle
 * Woche), aus dem persönlichen Tagesplan des angemeldeten Profils. Profil und
 * Haushalt kommen ausschließlich aus der Session.
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = weeklyShoppingQuerySchema.safeParse({ date: searchParams.get("date") ?? undefined });
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }

  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });

  const shopping = await getWeeklyShoppingForProfile(profile.id, parsed.data.date);
  return NextResponse.json({ shopping });
}
