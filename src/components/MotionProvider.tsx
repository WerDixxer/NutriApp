"use client";

import { MotionConfig } from "framer-motion";

/**
 * Ein Wrapper, kein eigenes Feature: `reducedMotion="user"` lässt
 * framer-motion automatisch auf System-`prefers-reduced-motion` reagieren
 * (transformbasierte Animationen werden dann übersprungen), ohne dass jede
 * einzelne `motion.*`-Stelle im Code das selbst prüfen muss.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </MotionConfig>
  );
}
