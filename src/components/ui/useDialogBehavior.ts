"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), a[href], summary, [tabindex]:not([tabindex="-1"])';

/**
 * Das gemeinsame Tastatur- und Fokusverhalten für Dialoge und Sheets
 * (Rezept-Dialog, Wocheneinkauf), damit es nur EINE Umsetzung gibt:
 *
 * - Escape schließt.
 * - Beim Öffnen wandert der Fokus auf `initialFocusRef` (meist der Schließen-Button).
 * - Tab und Shift+Tab bleiben im Panel (Fokusfalle).
 * - Beim Schließen geht der Fokus zurück auf `returnFocusRef` bzw. auf das
 *   Element, das beim Öffnen fokussiert war. Der Aufrufer setzt `returnFocusRef`
 *   vor dem Öffnen (manche Browser fokussieren Buttons beim Klick nicht).
 * - Optional (`lockScroll`): die Seite dahinter scrollt nicht mit. Die Breite der
 *   Scrollleiste wird als Padding ersetzt, damit sich der Inhalt nicht verschiebt.
 */
export function useDialogBehavior({
  open,
  onClose,
  panelRef,
  initialFocusRef,
  returnFocusRef,
  lockScroll = false,
}: {
  open: boolean;
  onClose: () => void;
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  lockScroll?: boolean;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const returnTarget = returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    initialFocusRef.current?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTarget?.focus();
    };
  }, [open, panelRef, initialFocusRef, returnFocusRef]);

  useEffect(() => {
    if (!open || !lockScroll) return;
    const body = document.body;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
    }
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [open, lockScroll]);
}
