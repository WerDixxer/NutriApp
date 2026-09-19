"use client";

import { motion } from "framer-motion";

/**
 * Die Hauptmetrik des Dashboards. Ein Ring, eine Zahl - Kalorien bleiben
 * die primäre Anzeige, Makros stehen daneben (siehe DashboardClient),
 * konkurrieren aber nicht mit dem Ring.
 */
export function CalorieRing({
  value,
  target,
  size = 120,
  strokeWidth = 9,
  inverse = false,
}: {
  value: number;
  target: number;
  size?: number;
  strokeWidth?: number;
  /** Für die Verwendung auf dunklem Grund (Dashboard-Hero-Panel). */
  inverse?: boolean;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(value / target, 1) : 0;
  const over = value > target;
  const valueSize = Math.round(size * 0.19);
  const labelSize = Math.max(11, Math.round(size * 0.062));

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={inverse ? "rgba(255,255,255,0.12)" : "var(--color-bg-dim)"}
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={over ? "var(--color-accent)" : "var(--color-primary)"}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span
          className={`num font-display leading-none ${inverse ? "text-on-inverse" : "text-ink"}`}
          style={{ fontSize: valueSize }}
        >
          {Math.round(value)}
        </span>
        <span
          className={`mt-1.5 font-semibold ${inverse ? "text-on-inverse-soft" : "text-ink-soft"}`}
          style={{ fontSize: labelSize }}
        >
          von {Math.round(target)} kcal
        </span>
      </div>
    </div>
  );
}
