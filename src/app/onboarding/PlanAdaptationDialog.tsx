"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { useDialogBehavior } from "@/components/ui/useDialogBehavior";

type AdaptationStatus = "asking" | "adapting" | "adapted" | "failed";

/**
 * Frage nach dem Speichern eines Profils, dessen Änderung den Essensplan beeinflussen kann (R5E).
 * Das Profil ist zu diesem Zeitpunkt bereits gespeichert. Nur "Pläne anpassen" plant heute und die
 * künftigen gespeicherten Tage neu (POST /api/plan/regenerate); "Aktuelle Pläne behalten" ändert nichts.
 * `onDone` wird aufgerufen, sobald der Nutzer den Dialog verlässt - egal wie er sich entschieden hat.
 */
export default function PlanAdaptationDialog({ open, onDone }: { open: boolean; onDone: () => void }) {
  const [status, setStatus] = useState<AdaptationStatus>("asking");
  const panelRef = useRef<HTMLDivElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Während der Neuplanung schließt weder Escape noch ein Klick daneben den Dialog.
  const leave = () => {
    if (status !== "adapting") onDone();
  };
  useDialogBehavior({ open, onClose: leave, panelRef, initialFocusRef: firstActionRef, lockScroll: true });

  // Nach einem Statuswechsel steht die erste Aktion neu da (z.B. "Weiter"); der Fokus soll nicht verloren gehen.
  useEffect(() => {
    if (open && status !== "adapting") firstActionRef.current?.focus();
  }, [open, status]);

  async function adaptPlans() {
    setStatus("adapting");
    try {
      const res = await fetch("/api/plan/regenerate", { method: "POST" });
      setStatus(res.ok ? "adapted" : "failed");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            className="fixed inset-0 z-50 bg-ink/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={leave}
          />
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="shadow-lift fixed inset-x-4 top-1/2 z-50 mx-auto flex max-w-md -translate-y-1/2 flex-col gap-4 rounded-[var(--radius-lg)] border border-border bg-bg p-6"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18 }}
          >
            <h2 id={titleId} className="text-h3 text-ink">
              {status === "adapted" ? "Pläne angepasst" : "Essensplan anpassen?"}
            </h2>

            {(status === "asking" || status === "adapting") && (
              <p className="text-[14px] leading-snug text-ink-soft">
                Deine Profiländerungen sind gespeichert und können deinen aktuellen Essensplan beeinflussen. Möchtest du deine
                heutigen und zukünftigen Pläne anpassen? Vergangene Tage bleiben unverändert.
              </p>
            )}
            {status === "adapted" && (
              <p role="status" className="text-[14px] leading-snug text-ink-soft">
                Deine heutigen und zukünftigen Pläne wurden an dein Profil angepasst.
              </p>
            )}
            {status === "failed" && (
              <p role="alert" className="text-[14px] leading-snug text-ink-soft">
                Die Pläne konnten gerade nicht angepasst werden. Deine Profiländerungen sind gespeichert, deine bisherigen Pläne
                bleiben unverändert.
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {status === "adapted" ? (
                <Button ref={firstActionRef} type="button" onClick={onDone}>
                  Weiter
                </Button>
              ) : (
                <>
                  <Button ref={firstActionRef} type="button" onClick={() => void adaptPlans()} disabled={status === "adapting"}>
                    {status === "adapting" ? "Pläne werden angepasst…" : status === "failed" ? "Erneut versuchen" : "Pläne anpassen"}
                  </Button>
                  <Button type="button" variant="bordered" onClick={onDone} disabled={status === "adapting"}>
                    Aktuelle Pläne behalten
                  </Button>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
