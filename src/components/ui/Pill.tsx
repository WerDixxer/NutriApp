import type { ButtonHTMLAttributes } from "react";

/**
 * Toggle-Chip-Pattern (Meal-Plan-Generator, Onboarding, Filter). Rein
 * visuell - `active`/`onClick` steuert weiterhin der Aufrufer.
 */
export function Pill({
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors duration-[var(--duration-fast)] ${
        active ? "bg-ink text-white" : "bg-bg-dim text-ink-soft hover:bg-bg-dim-hover"
      } ${className}`}
      {...props}
    />
  );
}
