/**
 * Erster echter Lade-Baustein der App (bisher gab es nur deaktivierte
 * Buttons/Fließtext-Sätze wie "Wird berechnet …"). Reines CSS
 * (background-position-Loop), kein zusätzliches Re-Render, respektiert
 * `prefers-reduced-motion` über die globale Regel in globals.css.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] bg-bg-dim ${className}`}
      style={{ animationDuration: "1.4s" }}
      aria-hidden="true"
    />
  );
}
