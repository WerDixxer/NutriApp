import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { tags } = (await request.json()) as { tags: string[] };

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  await prisma.profile.update({
    where: { id: profile.id },
    data: { subscribedTrendTags: JSON.stringify(tags) },
  });

  return NextResponse.json({ ok: true });
}
