"use client";

import Link from "next/link";
import { motion } from "framer-motion";

/**
 * "Entscheide für mich" als kompakte CTA-Karte, bewusst NICHT als Ring:
 * ein zweiter, ring-förmiger Fortschrittsindikator direkt neben dem echten
 * Kalorien-Ring (CalorieRing) hätte suggeriert, hier gäbe es einen zweiten
 * Messwert - gab es nie (der alte Ring zeigte einen fest codierten, nicht
 * datengebundenen Wert). Gleiches Ziel/Verhalten wie zuvor: Link zum Coach,
 * der dort automatisch die Entscheidung auslöst (`?ask=decide`). Bewusst
 * ohne Icon - die eine prominente, solide Aktion der Seite, keine
 * "AI-Feature-Karte".
 */
export function DecideRing() {
  return (
    <Link href="/assistant?ask=decide" className="group inline-block">
      <motion.div
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98 }}
        className="flex h-11 items-center rounded-full bg-ink px-5 text-white transition-colors duration-[var(--duration-fast)] group-hover:bg-black"
      >
        <span className="text-[14px] font-semibold">Entscheide für mich</span>
      </motion.div>
    </Link>
  );
}
