"use client";

import { motion } from "framer-motion";

export function CalorieRing({
  value,
  target,
  size = 120,
  strokeWidth = 9,
}: {
  value: number;
  target: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(value / target, 1) : 0;
  const over = value > target;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-bg-dim)" strokeWidth={strokeWidth} />
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
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="num text-xl font-extrabold leading-none text-ink">{Math.round(value)}</span>
        <span className="mt-1 text-[10px] font-semibold text-ink-soft">/ {Math.round(target)} kcal</span>
      </div>
    </div>
  );
}
