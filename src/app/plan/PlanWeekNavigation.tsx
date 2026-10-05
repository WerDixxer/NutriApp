import Link from "next/link";
import { addDays, type CalendarDate } from "@/lib/calendarDate";

const LINK_CLASS =
  "inline-flex min-h-11 items-center text-[13.5px] font-medium text-ink-soft underline-offset-4 transition-colors duration-[var(--duration-fast)] hover:text-ink hover:underline";

/**
 * Wochen-Navigation auf /plan: nur zurück in vergangene Wochen, nie in die Zukunft. Außerhalb der
 * laufenden Woche führt ein Link zurück zu ihr (`/plan` ohne Parameter ist immer die laufende Woche).
 */
export default function PlanWeekNavigation({ weekStart, isCurrentWeek }: { weekStart: CalendarDate; isCurrentWeek: boolean }) {
  return (
    <nav aria-label="Wochen" className="mt-4 flex flex-wrap items-center gap-x-6">
      <Link href={`/plan?week=${addDays(weekStart, -7)}`} className={LINK_CLASS}>
        ← Vorherige Woche
      </Link>
      {!isCurrentWeek && (
        <Link href="/plan" className={LINK_CLASS}>
          Zur aktuellen Woche
        </Link>
      )}
    </nav>
  );
}
