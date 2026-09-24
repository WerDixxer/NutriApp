"use client";

import { useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { addTag, moveActive, redirectFieldClickToInput, selectSuggestion, tagToCommit, type TagSuggestion } from "@/lib/tagInput";

export type { TagSuggestion };

export function TagInput({
  values,
  onChange,
  placeholder,
  chipClassName = "bg-primary-soft text-primary-dark",
  suggest,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  chipClassName?: string;
  /**
   * Optional: kanonische Vorschläge zur aktuellen Eingabe. Ohne diese Prop
   * verhält sich das Feld wie ein reines Freitextfeld.
   */
  suggest?: (query: string, selected: string[]) => TagSuggestion[];
}) {
  const [draft, setDraft] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = suggest && !dismissed ? suggest(draft, values) : [];
  const open = suggestions.length > 0;
  const active = open ? Math.min(activeIndex, suggestions.length - 1) : -1;

  function resetDraft() {
    setDraft("");
    setActiveIndex(0);
    setDismissed(false);
  }

  function commit(value: string) {
    onChange(addTag(values, value));
    resetDraft();
  }

  return (
    <div
      className="relative"
      onClick={(e) => {
        if (redirectFieldClickToInput(e)) inputRef.current?.focus();
      }}
    >
      <div className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-[var(--radius-md)] bg-bg-dim px-3 py-2">
        <AnimatePresence initial={false}>
          {values.map((v) => (
            <motion.span
              key={v}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${chipClassName}`}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </motion.span>
          ))}
        </AnimatePresence>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setActiveIndex(0);
            setDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (!open) return;
              e.preventDefault();
              setActiveIndex(moveActive(active, suggestions.length, e.key === "ArrowDown" ? 1 : -1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              commit(tagToCommit(draft, suggestions, active));
            } else if (e.key === ",") {
              // Komma speichert den Text genau so, wie er getippt wurde.
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              setDismissed(true);
            } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length === 0 ? placeholder : ""}
          role={suggest ? "combobox" : undefined}
          aria-expanded={suggest ? open : undefined}
          aria-controls={suggest && open ? listId : undefined}
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          aria-autocomplete={suggest ? "list" : undefined}
          className="min-w-[120px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft/60"
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          // mousedown würde sonst das Feld verlassen und per onBlur den Rohtext speichern, bevor der Klick ankommt.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg py-1 shadow-[var(--shadow-soft)]"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.label}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={(e) => {
                onChange(selectSuggestion(e, values, s));
                resetDraft();
              }}
              className={`flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm ${
                i === active ? "bg-primary-soft text-primary-dark" : "text-ink"
              }`}
            >
              <span>{s.label}</span>
              {s.hint && <span className="text-xs text-ink-soft">{s.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
