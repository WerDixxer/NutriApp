import type { BudgetPeriodType } from "@prisma/client";

export interface PeriodBounds {
  start: Date;
  end: Date;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Montag als Wochenbeginn, exakt dieselbe Logik wie mondayOfWeek() in
 * src/app/plan/page.tsx (dort nicht exportiert, deshalb hier bewusst
 * dieselbe kleine, lokale Berechnung statt eines fragwürdigen Imports quer
 * über eine Page-Komponente).
 */
function mondayOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7; // 0 = Montag
  d.setDate(d.getDate() - weekday);
  return d;
}

function getWeekBounds(now: Date): PeriodBounds {
  const start = mondayOfWeek(now);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthBounds(now: Date): PeriodBounds {
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

/**
 * Berechnet die Grenzen der AKTUELLEN Periode rein aus `now` (lokale
 * Zeitzone, wie der Rest der App, siehe pantry/expiration.ts). FoodBudget
 * speichert bewusst kein eigenes Start-/Enddatum: eine wiederkehrende
 * Einstellung ("60€ pro Woche") soll nie durch ein veraltetes Anker-Datum
 * aus dem Ruder laufen, die Periode ergibt sich deterministisch aus dem
 * heutigen Datum.
 */
export function getCurrentPeriodBounds(periodType: BudgetPeriodType, now: Date = new Date()): PeriodBounds {
  return periodType === "WEEK" ? getWeekBounds(now) : getMonthBounds(now);
}
