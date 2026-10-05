import type { MealPlanStatus, Prisma } from "@prisma/client";

/**
 * Lebenszyklus eines Haushaltsplans (R5E, R5F-5): DRAFT → ACTIVE → ARCHIVED.
 *
 * - DRAFT: erstellt, noch nicht übernommen.
 * - ACTIVE: der übernommene Plan für seinen Zeitraum. Je Haushalt ist an jedem Kalendertag höchstens
 *   ein Plan ACTIVE: Wird ein Plan aktiv, werden alle ACTIVE-Pläne des Haushalts archiviert, deren
 *   Zeitraum sich mit seinem überschneidet (ganz, auch bei nur teilweiser Überschneidung).
 * - ARCHIVED: bleibt als Historie erhalten und wird nicht mehr verändert.
 *
 * Andere Übergänge (z.B. ARCHIVED → ACTIVE, ACTIVE → DRAFT, DRAFT → ARCHIVED) gibt es bewusst nicht.
 *
 * Warum keine Datenbank-Regel: "höchstens ein ACTIVE je überschneidendem Zeitraum" lässt sich in
 * SQLite/Prisma nicht als Unique-Index ausdrücken (ein partieller Index erlaubte nur einen ACTIVE-Plan
 * je Haushalt insgesamt). Die Regel setzt mealPlanService.ts transaktional durch.
 */
const ALLOWED_TRANSITIONS: Record<MealPlanStatus, readonly MealPlanStatus[]> = {
  DRAFT: ["ACTIVE"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: [],
};

export function isAllowedStatusTransition(from: MealPlanStatus, to: MealPlanStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Pläne, deren Zeitraum [startDate, endDate] (Kalendertage einschließlich) sich mit dem gegebenen überschneidet. */
export function overlappingPeriod(startDate: Date, endDate: Date) {
  return { startDate: { lte: endDate }, endDate: { gte: startDate } } satisfies Prisma.MealPlanWhereInput;
}
