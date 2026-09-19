/**
 * Kapitel 12: Contextual Insights. Ein Insight ist ein reines Wertobjekt -
 * es wird NIE gespeichert, sondern bei jedem Aufruf aus bestehenden Daten
 * (Pantry/MealPlanDay/Budget/Recipe) neu berechnet, siehe insightService.ts.
 * Nur die Entscheidung "dismissed" überlebt einen Seitenaufruf (siehe
 * DismissedInsight in schema.prisma).
 */

export type InsightPriority = "critical" | "important" | "useful" | "informational";

/** Niedrigere Zahl = relevanter. Bewusst eine einfache Rangfolge statt eines
 *  numerischen Scoring-Systems (siehe Kapitel-Auftrag Abschnitt 5). */
export const INSIGHT_PRIORITY_ORDER: Record<InsightPriority, number> = {
  critical: 0,
  important: 1,
  useful: 2,
  informational: 3,
};

export type InsightCategory = "PANTRY" | "MEAL_PLAN" | "BUDGET" | "RECIPE";

/** Wo ein Insight angezeigt werden darf. Ein Insight kann mehrere Surfaces
 *  tragen (z.B. ein Pantry-Insight erscheint auf Dashboard UND Pantry). */
export type InsightSurface = "DASHBOARD" | "PANTRY" | "PLAN" | "BUDGET";

/** Konkrete Regel, die das Insight erzeugt hat - für Nachvollziehbarkeit
 *  (Abschnitt 12: "welche Regel hat das erzeugt?"), nie nur die Kategorie. */
export type InsightType =
  | "PANTRY_EXPIRING_SOON"
  | "PANTRY_EXPIRED"
  | "MEAL_PLAN_MISSING_INGREDIENTS"
  | "MEAL_PLAN_FULLY_COVERED"
  | "MEAL_PLAN_INGREDIENT_EXPIRES_BEFORE_MEAL"
  | "BUDGET_OVER"
  | "BUDGET_NEAR_LIMIT"
  | "BUDGET_UNDER_WITH_ROOM"
  | "RECIPE_MATCHES_AVAILABLE_PANTRY";

/** Woher die Daten stammen, die dieses Insight ausgelöst haben (Abschnitt 12:
 *  Provenance). `entity` ist der Modellname, `id` die jeweilige Zeilen-ID. */
export interface InsightSource {
  entity: "PantryItem" | "MealPlanItem" | "FoodBudget" | "Recipe";
  id: string;
}

export interface InsightAction {
  label: string;
  href: string;
}

export interface Insight {
  /** Stabiler Dedupe-Schlüssel: gleiche zugrunde liegende Tatsache -> gleiche
   *  id, über mehrere Aufrufe/Renders hinweg (siehe dedupe.ts). */
  id: string;
  type: InsightType;
  category: InsightCategory;
  priority: InsightPriority;
  /** Ein fertiger, anzeigefertiger Satz - kein Fragment, keine Vorlage mit Lücken. */
  message: string;
  /** Werte, die die Nachricht erklären/debuggen helfen (Abschnitt 12), nie zusätzlich angezeigt. */
  context: Record<string, string | number>;
  source: InsightSource;
  surfaces: InsightSurface[];
  action?: InsightAction;
  detectedAt: Date;
  /** Ab wann dieses Insight von selbst nicht mehr relevant ist (z.B. der Mahlzeit-Tag ist vorbei). Rein informativ, die Detektoren selbst erzeugen es ohnehin nur, solange es relevant ist. */
  expiresAt?: Date | null;
}
