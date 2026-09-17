"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { approxGrams, approxKcal } from "@/lib/format";

export default function TrendsGrid({ recipes }: { recipes: RecipeDetail[] }) {
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) for (const t of r.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [recipes]);

  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.profile?.subscribedTrendTags) setSelected(data.profile.subscribedTrendTags);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  function toggleTag(tag: string) {
    const next = selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];
    setSelected(next);
    fetch("/api/profile/trend-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: next }),
    }).catch(() => {});
  }

  const visible =
    selected.length === 0
      ? recipes
      : recipes.filter((r) => r.tags?.some((t) => selected.includes(t)));

  return (
    <div className="flex flex-col gap-5">
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-6">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Feed filtern
          </span>
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                selected.includes(tag)
                  ? "bg-ink text-white"
                  : "bg-bg-dim text-ink-soft hover:text-ink"
              }`}
            >
              #{tag}
            </button>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => {
                setSelected([]);
                fetch("/api/profile/trend-tags", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tags: [] }),
                }).catch(() => {});
              }}
              className="text-xs font-medium text-ink-soft underline underline-offset-2 hover:text-primary"
            >
              zurücksetzen
            </button>
          )}
        </div>
      )}

      {loaded && visible.length === 0 && (
        <p className="py-6 text-sm text-ink-soft">
          Keine Trends mit diesen Tags. Wähle einen anderen Tag oder setze den Filter zurück.
        </p>
      )}

      <div>
        {visible.map((r, i) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03, duration: 0.3 }}
            className="flex items-center gap-4 border-b border-border py-4"
          >
            <RecipeDetailModal
              recipe={r}
              trigger={
                <span className="flex min-w-0 flex-1 items-center gap-4 text-left">
                  <RecipeThumb recipe={r} className="h-14 w-14 shrink-0 rounded-2xl text-2xl" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15.5px] font-semibold text-ink">{r.name}</span>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-accent">
                        <span className="animate-flame">🔥</span> Trend
                      </span>
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-sm text-ink-soft">{r.description}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs font-medium text-ink-soft">
                      <span>{approxKcal(r.kcal)}</span>
                      <span>·</span>
                      <span>{approxGrams(r.proteinG)} Protein</span>
                      <span>·</span>
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
