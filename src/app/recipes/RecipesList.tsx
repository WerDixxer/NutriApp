"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { approxGrams, approxKcal } from "@/lib/format";

export default function RecipesList({ recipes }: { recipes: RecipeDetail[] }) {
  const router = useRouter();
  const [items, setItems] = useState(recipes);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/recipes?id=${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((r) => r.id !== id));
    setDeletingId(null);
    router.refresh();
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Noch keine eigenen Rezepte"
        description="Füge dein erstes selbstgekochtes Gericht hinzu. Es fließt danach automatisch in deinen Essensplan mit ein."
      />
    );
  }

  return (
    <div className="border-t border-border">
      {items.map((r, i) => (
        <motion.div
          key={r.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03, duration: 0.3 }}
          className="flex min-h-[86px] items-center gap-4 border-b border-border py-4"
        >
          <RecipeDetailModal
            recipe={r}
            trigger={
              <span className="flex min-w-0 flex-1 items-center gap-4 text-left">
                <RecipeThumb recipe={r} className="h-14 w-14 shrink-0 rounded-[var(--radius-md)] text-2xl" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-semibold text-ink">{r.name}</span>
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
          <button
            onClick={() => handleDelete(r.id)}
            disabled={deletingId === r.id}
            aria-label="Rezept löschen"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors duration-[var(--duration-fast)] hover:text-primary disabled:opacity-40"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </motion.div>
      ))}
    </div>
  );
}
