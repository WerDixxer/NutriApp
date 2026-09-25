import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { admitAssistantRequest, finishAssistantRequest, type AssistantAdmission } from "@/lib/agents/assistantUsage";
import { runFoodAssistant } from "@/lib/agents/foodAssistant";
import { LLMConfigError, LLMTimeoutError } from "@/lib/agents/llmProvider";
import { getApiUserId } from "@/lib/session";
import { assistantMessageSchema } from "@/lib/validation/assistant";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

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

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = assistantMessageSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const { message } = parsed.data;

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  // Ab hier zählt die Anfrage (F-20): Limits pro Nutzer, höchstens eine aktive Anfrage.
  const admission = await admitAssistantRequest(userId);
  if (!admission.ok) return rejectedAdmissionResponse(admission);

  try {
    const result = await runFoodAssistant(profile.id, message);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LLMConfigError) {
      console.error("Food Assistant configuration error:", err.message);
      return NextResponse.json({ error: "Der Assistent ist gerade nicht verfügbar." }, { status: 503 });
    }
    if (err instanceof LLMTimeoutError) {
      return NextResponse.json({ error: "Der Assistent hat zu lange gebraucht. Versuch es gleich nochmal." }, { status: 504 });
    }
    console.error("Food Assistant error:", err);
    return NextResponse.json(
      { error: "Der Assistent hatte gerade ein Problem. Versuch es nochmal." },
      { status: 500 },
    );
  } finally {
    // Sperre immer freigeben; scheitert das, gibt sie STALE_ACTIVE_REQUEST_MS später wieder frei.
    await finishAssistantRequest(admission.requestId).catch((error: unknown) => console.error("Assistant request release failed:", error));
  }
}

function rejectedAdmissionResponse(admission: Exclude<AssistantAdmission, { ok: true }>) {
  if (admission.reason === "ACTIVE_REQUEST") {
    return NextResponse.json({ error: "Dein Assistent beantwortet gerade noch eine Anfrage. Warte kurz, bis sie fertig ist." }, { status: 429 });
  }
  return NextResponse.json(
    { error: "Du hast das Limit für Assistant-Anfragen erreicht. Versuch es später noch einmal." },
    { status: 429, headers: { "Retry-After": String(admission.retryAfterSeconds) } },
  );
}
