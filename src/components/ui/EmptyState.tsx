import type { LucideIcon } from "lucide-react";

/**
 * Konsistente Leer-Darstellung statt der bisher uneinheitlichen Ad-hoc-
 * Sätze (mal `text-sm`, mal `font-display text-lg`). Zeigt nur, was da ist -
 * erfindet keine Funktionalität (kein CTA, wenn der Aufrufer keinen übergibt).
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border px-6 py-12 text-center">
      {Icon && <Icon className="h-6 w-6 text-ink-faint" strokeWidth={1.75} />}
      <p className="text-h3 text-ink">{title}</p>
      {description && <p className="text-body max-w-[36ch] text-ink-soft">{description}</p>}
      {action}
    </div>
  );
}
