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
      <span className="text-label text-ink-faint">Dein Coach</span>
      <h1 className="text-h1 mt-2 text-ink">Frag einfach.</h1>
      <p className="text-body mt-3 max-w-[52ch] text-ink-soft">
        Beschreib deine Situation in eigenen Worten: verbleibende Kalorien, was im Kühlschrank liegt, wie viel Zeit
        du hast. Wir greifen dabei ausschließlich auf deine echte Rezeptdatenbank zurück.
      </p>
      <AssistantChat initialMessages={initialMessages} />
    </div>
  );
}
