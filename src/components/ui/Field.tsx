import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/**
 * Ersetzt die bisher in ~8 Dateien identisch kopierte `inputClass`-Zeichenkette.
 * Reines Styling - Formularverhalten (value/onChange/required/...) bleibt
 * beim Aufrufer, hier wird nichts an Logik ergänzt.
 */
const CONTROL_CLASS =
  "w-full rounded-[var(--radius-sm)] border border-border bg-bg-dim px-3.5 py-2.5 text-[14.5px] text-ink placeholder:text-ink-faint outline-none transition-colors duration-[var(--duration-fast)] focus:border-ink focus:bg-bg";

export const inputClassName = CONTROL_CLASS;

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...props },
  ref,
) {
  return <input ref={ref} className={`${CONTROL_CLASS} ${className}`} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", ...props },
  ref,
) {
  return <select ref={ref} className={`${CONTROL_CLASS} ${className}`} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = "", ...props }, ref) {
    return <textarea ref={ref} className={`${CONTROL_CLASS} ${className}`} {...props} />;
  },
);

export function Label({
  children,
  htmlFor,
  hint,
}: {
  children: ReactNode;
  htmlFor?: string;
  hint?: string;
}) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {children}
      </label>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={htmlFor} hint={hint}>
        {label}
      </Label>
      {children}
    </div>
  );
}
