"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export interface InsightView {
  id: string;
  message: string;
  priority: "critical" | "important" | "useful" | "informational";
  action?: { label: string; href: string };
}

const PRIORITY_DOT: Record<InsightView["priority"], string> = {
  critical: "var(--color-danger)",
  important: "var(--color-primary)",
  useful: "var(--color-accent)",
  informational: "var(--color-border-strong)",
};

/**
 * Ein Insight ist keine Karte für sich - alle Insights teilen sich EINE
 * Fläche (siehe Kapitel-Vorgabe "weniger Karten-Gefühl"), Zeilen trennt nur
 * eine dezente Linie, wie bei den Makro-Zeilen im Kalorien-Panel. Der
 * Prioritäts-Punkt ist funktional (Farbe = Dringlichkeit, wie der Pantry-
 * Dringlichkeits-Punkt), keine Dekoration.
 *
 * Rendert `null`, sobald keine Insights mehr übrig sind - kein leerer
 * Rahmen, kein "Alles erledigt!"-Text (Kapitel-Auftrag Abschnitt 10/16: die
 * Fläche verschwindet einfach, statt Nutzen vorzutäuschen).
 */
export function InsightsPanel({ initialInsights }: { initialInsights: InsightView[] }) {
  const [insights, setInsights] = useState(initialInsights);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  async function dismiss(id: string) {
    setDismissingId(id);
    setInsights((prev) => prev.filter((i) => i.id !== id));
    try {
      await fetch("/api/insights/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ insightKey: id }),
      });
    } finally {
      setDismissingId(null);
    }
  }

  if (insights.length === 0) return null;

  return (
    <div className="rounded-[var(--radius-md)] bg-bg-dim px-4 py-1 sm:px-5">
      <AnimatePresence initial={false}>
        {insights.map((insight, idx) => (
          <motion.div
            key={insight.id}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className={`flex items-start gap-3 py-3 ${idx > 0 ? "border-t border-border" : ""}`}
          >
            <span
              className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: PRIORITY_DOT[insight.priority] }}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-snug text-ink">{insight.message}</p>
              {insight.action && (
                <Link
                  href={insight.action.href}
                  className="mt-1 inline-block text-[12px] font-semibold text-primary transition-colors duration-[var(--duration-fast)] hover:text-primary-dark"
                >
                  {insight.action.label}
                </Link>
              )}
            </div>
            <button
              onClick={() => dismiss(insight.id)}
              disabled={dismissingId === insight.id}
              aria-label="Ausblenden"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim-hover hover:text-ink-soft"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
