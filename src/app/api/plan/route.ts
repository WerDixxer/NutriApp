import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import { getApiUserId } from "@/lib/session";

export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateParam = searchParams.get("date");
  const date = dateParam ? new Date(dateParam) : new Date();

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  const plan = await getOrGenerateDayPlan(profile.id, date);
  return NextResponse.json({ plan });
}
