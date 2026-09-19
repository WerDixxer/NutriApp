import type { ReactNode } from "react";

/**
 * Das Eyebrow/H1/Intro-Dreiklang, der bisher auf jeder Seite einzeln
 * zusammengebaut wurde (Pantry, Budget, Recipes, Plan, Meal Plans, ...).
 * `action` platziert z.B. einen Button rechts neben der Überschrift
 * (Recipes-Seite), ohne dass jede Seite das Flex-Layout neu schreibt.
 */
export function SectionHeader({
  eyebrow,
  title,
  intro,
  action,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="text-label text-ink-faint">{eyebrow}</span>
        <h1 className="text-h1 mt-2 text-ink">{title}</h1>
        {intro && <p className="text-body mt-2.5 max-w-[52ch] text-ink-soft">{intro}</p>}
      </div>
      {action}
    </div>
  );
}
