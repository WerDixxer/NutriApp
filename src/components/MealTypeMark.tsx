/**
 * Abstrakte NutriCoach-eigene Kennzeichnung für Mahlzeiten-Slots - bewusst
 * KEIN Food-Emoji/Icon-Set (Pfanne, Ei, Burger, Apfel, ...), siehe Kapitel-
 * Vorgabe "Meal-type icons". Nutzt stattdessen dieselbe Bildsprache wie der
 * Kalorien-Ring (CalorieRing): ein kleiner Kreis mit einem Bogen-Segment.
 * Rotation + Bogenlänge unterscheiden die Slots metaphorisch nach Tageszeit
 * (oben = hell/früh, unten = spät), ohne eine echte Uhrzeit zu behaupten.
 * Snack bekommt bewusst eine andere Grundform (Punkt statt Bogen) - kein
 * fester Zeitpunkt. `currentColor` macht die Markierung auf hellem wie
 * dunklem Grund (z.B. im Dashboard-Hero-Panel) einsetzbar.
 */
interface ArcConfig {
  rotateDeg: number;
  arcDeg: number;
}

const SLOT_MARK: Record<string, ArcConfig | "dot" | undefined> = {
  BREAKFAST: { rotateDeg: -125, arcDeg: 70 },
  LUNCH: { rotateDeg: -55, arcDeg: 70 },
  DINNER: { rotateDeg: 95, arcDeg: 100 },
  SNACK: "dot",
  PRE_WORKOUT: { rotateDeg: -170, arcDeg: 40 },
  POST_WORKOUT: { rotateDeg: 150, arcDeg: 40 },
};

export function MealTypeMark({
  slot,
  size = 18,
  className = "",
}: {
  slot: string;
  size?: number;
  className?: string;
}) {
  const config = SLOT_MARK[slot];
  const strokeWidth = Math.max(1.5, size * 0.11);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  if (!config || config === "dot") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${className}`}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        <span className="rounded-full bg-current" style={{ width: size * 0.32, height: size * 0.32, opacity: 0.85 }} />
      </span>
    );
  }

  const arcLength = (config.arcDeg / 360) * circumference;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      style={{ transform: `rotate(${config.rotateDeg}deg)` }}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={`${arcLength} ${circumference - arcLength}`}
      />
    </svg>
  );
}
