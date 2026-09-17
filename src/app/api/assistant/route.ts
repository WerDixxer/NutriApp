import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runFoodAssistant } from "@/lib/agents/foodAssistant";
import { LLMConfigError } from "@/lib/agents/llmProvider";
import { getApiUserId } from "@/lib/session";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ messages: [] });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ messages: [] });

  const messages = await prisma.assistantMessage.findMany({
    where: { profileId: profile.id },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { message } = (await request.json()) as { message: string };
  if (!message || !message.trim()) {
    return NextResponse.json({ error: "Nachricht fehlt." }, { status: 400 });
  }

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  try {
    const result = await runFoodAssistant(profile.id, message.trim());
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LLMConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("Food Assistant error:", err);
    return NextResponse.json(
      { error: "Der Assistent hatte gerade ein Problem. Versuch es nochmal." },
      { status: 500 },
    );
  }
}
