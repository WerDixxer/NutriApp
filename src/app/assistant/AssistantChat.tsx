"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { approxGrams, approxKcal } from "@/lib/format";

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  recipes?: RecipeDetail[];
}

const STARTERS = [
  "Ich habe noch 500 kcal und brauche 40 g Protein. Was passt?",
  "Entscheide für mich, was ich jetzt essen soll.",
  "Rette meine Makros.",
  "Ich habe Hähnchen, Reis und Paprika zuhause. Was kann ich kochen?",
];

const ASK_PRESETS: Record<string, string> = {
  decide: "Entscheide für mich, was ich jetzt essen soll.",
  rescue: "Rette meine Makros.",
};

export default function AssistantChat({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoSentRef = useRef(false);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  useEffect(() => {
    const ask = searchParams.get("ask");
    if (ask && ASK_PRESETS[ask] && !autoSentRef.current) {
      autoSentRef.current = true;
      send(ASK_PRESETS[ask]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setError(null);
    setDraft("");
    setMessages((prev) => [...prev, { id: `local-${Date.now()}-u`, role: "USER", content: trimmed }]);
    setSending(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Der Assistent hatte ein Problem.");
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}-a`, role: "ASSISTANT", content: data.reply, recipes: data.recipes },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-14">
      <div>
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 pb-6">
            <p className="text-sm font-semibold text-ink-soft">Frag mich zum Beispiel</p>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="w-fit text-left text-[15px] text-ink underline decoration-border decoration-2 underline-offset-4 hover:text-primary hover:decoration-primary"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col gap-2 border-b border-border py-6 ${
              m.role === "ASSISTANT" ? "pl-5" : ""
            }`}
            style={m.role === "ASSISTANT" ? { boxShadow: "inset 2px 0 0 var(--color-primary)" } : undefined}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
              {m.role === "USER" ? "Du" : "Coach"}
            </span>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{m.content}</p>

            {m.recipes && m.recipes.length > 0 && (
              <div className="mt-2 flex flex-col">
                {m.recipes.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                    <RecipeThumb recipe={r} className="h-11 w-11 shrink-0 rounded-xl text-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{r.name}</div>
                      <div className="text-xs text-ink-soft">
                        {approxKcal(r.kcal)} · {approxGrams(r.proteinG)} Protein
                      </div>
                    </div>
                    <RecipeDetailModal recipe={r} trigger="Details" />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div className="flex flex-col gap-2 border-b border-border py-6 pl-5" style={{ boxShadow: "inset 2px 0 0 var(--color-primary)" }}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">Coach</span>
            <p className="text-sm text-ink-soft">Überlegt gerade.</p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-3 text-sm text-primary">{error}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="mt-4 flex items-end gap-4"
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(draft);
            }
          }}
          placeholder="Frag deinen Coach"
          rows={2}
          className="flex-1 resize-none rounded-2xl bg-bg-dim px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-soft/70"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="shrink-0 rounded-full bg-ink px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-40"
        >
          Senden
        </button>
      </form>
    </div>
  );
}
