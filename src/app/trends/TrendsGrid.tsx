"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { Pill } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/EmptyState";
import { approxGrams, approxKcal } from "@/lib/format";
import { loadTrendTags, saveTrendTags } from "./trendTagRequests";

export default function TrendsGrid({ recipes }: { recipes: RecipeDetail[] }) {
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) for (const t of r.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [recipes]);

  const [selected, setSelected] = useState<string[]>([]);
  // Gespeichert wird immer die vollständige Liste: nur nach erfolgreichem Laden, nie parallel (R5F-3).
  const [tagsStatus, setTagsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const canChangeTags = tagsStatus === "ready" && !saving;

  useEffect(() => {
    let active = true;
    void loadTrendTags().then((result) => {
      if (!active) return;
      if (result.ok) {
        setSelected(result.tags);
        setTagsStatus("ready");
      } else {
        setTagError(result.message);
        setTagsStatus("error");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  /** Übernimmt die neue Auswahl erst, wenn der Server sie gespeichert hat. */
  async function changeTags(next: string[]) {
    if (!canChangeTags) return;
    setSaving(true);
    setTagError(null);
    const result = await saveTrendTags(next);
    setSaving(false);
    if (!result.ok) {
      setTagError(result.message);
      return;
    }
    setSelected(next);
  }

  function toggleTag(tag: string) {
    void changeTags(selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag]);
  }

  const visible =
    selected.length === 0
      ? recipes
      : recipes.filter((r) => r.tags?.some((t) => selected.includes(t)));

  return (
    <div className="flex flex-col gap-5">
      {allTags.length > 0 && (
        <div className="-mx-1 flex flex-wrap items-center gap-2 overflow-x-auto border-b border-border px-1 pb-6">
          <span className="text-label mr-1 text-ink-faint">Feed filtern</span>
          {allTags.map((tag) => (
            <Pill key={tag} active={selected.includes(tag)} onClick={() => toggleTag(tag)} disabled={!canChangeTags} className="h-8 px-3.5 text-xs">
              #{tag}
            </Pill>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => void changeTags([])}
              disabled={!canChangeTags}
              className="text-xs font-medium text-ink-soft underline underline-offset-2 transition-colors duration-[var(--duration-fast)] hover:text-primary"
            >
              zurücksetzen
            </button>
          )}
        </div>
      )}

      {tagError && (
        <p role="alert" className="text-[13.5px] font-semibold text-danger">
          {tagError}
        </p>
      )}

      {tagsStatus !== "loading" && visible.length === 0 && (
        <EmptyState
          title="Keine Trends mit diesen Tags"
          description="Wähle einen anderen Tag oder setze den Filter zurück."
        />
      )}

      <div>
        {visible.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
            className="flex min-h-[86px] items-center gap-4 border-b border-border px-2 py-4 transition-colors duration-[var(--duration-fast)] hover:bg-bg-dim/60 -mx-2"
          >
            <RecipeDetailModal
              recipe={r}
              trigger={
                <span className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <RecipeThumb recipe={r} className="h-14 w-14 shrink-0 rounded-[var(--radius-md)] text-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15.5px] font-semibold text-ink">{r.name}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent">
                        <TrendingUp className="h-3 w-3" /> Trend
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-[13.5px] text-ink-soft">{r.description}</span>
                    <span className="num mt-1 flex items-center gap-3 text-[12px] font-medium text-ink-faint">
                      <span>{approxKcal(r.kcal)}</span>
                      <span>{approxGrams(r.proteinG)} Protein</span>
                      <span>{r.prepTimeMin} Min.</span>
                    </span>
                  </span>
                </span>
              }
            />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
