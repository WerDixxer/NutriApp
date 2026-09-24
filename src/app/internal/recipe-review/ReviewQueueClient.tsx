"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { REVIEW_CATEGORY_LABELS, REVIEW_STATUS_LABELS } from "@/lib/labels";
import { REVIEW_STATUSES, type RecipeReviewItem, type ReviewStatus } from "@/lib/recipes/recipeReview";

/**
 * Status ist reiner UI-Zustand (Kapitel-19-Auftrag Abschnitt 5/11): ein `useState` je
 * Seitenaufruf, keine Persistenz, kein API-Aufruf. Ein Neuladen setzt jeden Eintrag auf den
 * Ausgangswert (immer "pending") zurück.
 */
const CATEGORY_TONE: Record<string, string> = {
  duplicate_exact: "text-danger",
  duplicate_possible: "text-warn",
  insufficient_data: "text-ink-faint",
  quality_issue: "text-warn",
  clean: "text-primary",
};

export function ReviewQueueClient({ items }: { items: RecipeReviewItem[] }) {
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>(() =>
    Object.fromEntries(items.map((item) => [item.recipeId, item.status])),
  );

  // Vorab berechnet (statt während des Renderns mutiert): welche Zeile die erste ihrer Kategorie ist.
  const isFirstOfCategory = items.map((item, i) => i === 0 || items[i - 1].category !== item.category);

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => {
        const showHeading = isFirstOfCategory[i];
        return (
          <li key={item.recipeId}>
            {showHeading && <h2 className="text-label mb-2 mt-7 text-ink-faint first:mt-0">{REVIEW_CATEGORY_LABELS[item.category]}</h2>}
            <Card className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/internal/recipe-review/${item.recipeId}`} className="text-[15px] font-semibold text-ink hover:underline">
                    {item.recipeName}
                  </Link>
                  <p className="mt-0.5 text-[13px] text-ink-soft">{item.reviewReason}</p>
                </div>
                <span className={`text-label shrink-0 ${CATEGORY_TONE[item.category]}`}>{REVIEW_CATEGORY_LABELS[item.category]}</span>
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Status für ${item.recipeName}`}>
                {REVIEW_STATUSES.map((status) => (
                  <Pill
                    key={status}
                    active={statuses[item.recipeId] === status}
                    aria-pressed={statuses[item.recipeId] === status}
                    onClick={() => setStatuses((prev) => ({ ...prev, [item.recipeId]: status }))}
                    className="h-7 px-3 text-[11.5px]"
                  >
                    {REVIEW_STATUS_LABELS[status]}
                  </Pill>
                ))}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
