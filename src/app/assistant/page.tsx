import { prisma } from "@/lib/db";
import AssistantChat, { type ChatMessage } from "./AssistantChat";
import { requireProfileId } from "@/lib/session";

export default async function AssistantPage() {
  const profileId = await requireProfileId();

  const history = await prisma.assistantMessage.findMany({
    where: { profileId },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const initialMessages: ChatMessage[] = history.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
  }));

  return (
    <div>
      <h1 className="font-display text-[40px] leading-[1.03] text-ink sm:text-[52px]">Dein Coach</h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Beschreib deine Situation in eigenen Worten: verbleibende Kalorien, was im Kühlschrank
        liegt, wie viel Zeit du hast. Der Coach greift dabei ausschließlich auf deine echte
        Rezeptdatenbank zurück und erfindet keine Nährwerte.
      </p>
      <AssistantChat initialMessages={initialMessages} />
    </div>
  );
}
