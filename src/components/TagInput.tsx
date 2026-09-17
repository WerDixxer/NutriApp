"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

export function TagInput({
  values,
  onChange,
  placeholder,
  chipClassName = "bg-primary-soft text-primary-dark",
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  chipClassName?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setDraft("");
  }

  return (
    <div className="flex min-h-[48px] flex-wrap items-center gap-2 rounded-2xl bg-bg-dim px-3 py-2">
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
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={values.length === 0 ? placeholder : ""}
        className="min-w-[120px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-soft/60"
      />
    </div>
  );
}
