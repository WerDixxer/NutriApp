"use client";

import Link from "next/link";
import { motion } from "framer-motion";

/**
 * Der visuelle Kern der App: "Entscheide für mich" als eigenständiges,
 * ring-basiertes Element (nicht als Button-in-einer-Card). Führt zum Coach
 * und löst dort automatisch die Entscheidung aus (siehe AssistantChat: `?ask=decide`).
 */
export function DecideRing({ size = 148 }: { size?: number }) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <Link href="/assistant?ask=decide" className="group inline-block">
      <motion.div
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-bg-dim)" strokeWidth={strokeWidth} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * 0.22}
          />
        </svg>
        <div className="absolute flex flex-col items-center text-center">
          <span className="text-[15px] font-bold leading-tight text-ink">
            Entscheide
            <br />
            für mich
          </span>
          <span className="mt-1 text-[10.5px] font-semibold text-ink-soft">1 Klick</span>
        </div>
      </motion.div>
    </Link>
  );
}
