import type { HTMLAttributes } from "react";

/**
 * Flache Fläche (bg-bg-dim), nie ein Schatten standardmäßig - Karten in
 * dieser App heben sich über Fläche/Radius ab, nicht über Tiefe. `elevated`
 * ist die Ausnahme für Elemente, die tatsächlich schweben sollen (sparsam
 * verwenden, siehe globals.css .shadow-soft).
 */
export function Card({
  className = "",
  elevated = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { elevated?: boolean }) {
  return (
    <div
      className={`rounded-[var(--radius-md)] bg-bg-dim ${elevated ? "shadow-soft" : ""} ${className}`}
      {...props}
    />
  );
}
