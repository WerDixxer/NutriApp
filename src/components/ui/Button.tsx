"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

type Variant = "primary" | "secondary" | "glass" | "bordered" | "ghost" | "danger-ghost";
type Size = "md" | "sm" | "icon";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-black disabled:hover:bg-ink",
  secondary: "bg-bg-dim text-ink hover:bg-bg-dim-hover",
  // Für Oberflächen auf dunklem/inversem Grund (z.B. innerhalb der Nav) oder
  // als zurückhaltende sekundäre Aktion neben einem primary-Button.
  glass: "glass border text-ink hover:bg-white",
  bordered: "border border-border-strong text-ink hover:border-ink",
  ghost: "text-ink-soft hover:text-ink",
  "danger-ghost": "text-ink-soft hover:text-danger",
};

const SIZE_CLASSES: Record<Size, string> = {
  md: "h-11 px-5 text-[14px]",
  sm: "h-9 px-4 text-[13px]",
  icon: "h-9 w-9",
};

export interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: Variant;
  size?: Size;
}

/**
 * Einzige Button-Stelle für die App. Ersetzt die bisher pro Datei neu
 * zusammengesetzten Klassenstrings (Pantry/Budget/Household/Onboarding/...).
 * `whileTap` ist bewusst dezent (0.97) - framer-motion respektiert über
 * `MotionProvider`/`MotionConfig` bereits `prefers-reduced-motion`.
 *
 * Variantenwahl (siehe Kapitel-Vorgabe "mehr als nur solid/ghost"):
 * primary = die eine laute Aktion pro Ansicht. secondary = neutrale Fläche.
 * glass = zurückhaltende Aktion auf strukturiertem/dunklem Grund. bordered =
 * sichtbare, aber ruhige Kontur ohne Fläche. ghost/danger-ghost = reine
 * Text-Aktionen (Abbrechen, Löschen).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", children, ...props },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors duration-[var(--duration-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {children}
    </motion.button>
  );
});
