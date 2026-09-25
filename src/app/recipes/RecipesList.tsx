"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import { RecipeDetailModal, RecipeThumb, type RecipeDetail } from "@/components/RecipeDetailModal";
import { EmptyState } from "@/components/ui/EmptyState";
import { approxGrams, approxKcal } from "@/lib/format";

const DELETE_FAILED_MESSAGE = "Das Rezept konnte nicht gelöscht werden. Bitte versuche es später noch einmal.";

export default function RecipesList({ recipes }: { recipes: RecipeDetail[] }) {
  const router = useRouter();
  const [items, setItems] = useState(recipes);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ recipeId: string; message: string } | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/recipes?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        // 409: Das Rezept steckt noch in einem Plan, die API liefert dafür eine Meldung für den Nutzer.
        // Ein unerwarteter Serverfehler hat keinen JSON-Body, dann bleibt es bei der allgemeinen Meldung.
        const data = await res.json().catch(() => null);
        setDeleteError({ recipeId: id, message: data?.error ?? DELETE_FAILED_MESSAGE });
        return;
      }
      setItems((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } catch {
      setDeleteError({ recipeId: id, message: DELETE_FAILED_MESSAGE });
    } finally {
      setDeletingId(null);
    }
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
          className="min-h-[86px] border-b border-border py-4"
        >
          <div className="flex items-center gap-4">
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
          </div>
          {deleteError?.recipeId === r.id && (
            <p role="alert" className="mt-3 text-[13.5px] font-semibold text-danger">
              {deleteError.message}
            </p>
          )}
        </motion.div>
      ))}
    </div>
  );
}
