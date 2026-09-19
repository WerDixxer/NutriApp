import { INSIGHT_PRIORITY_ORDER, type Insight } from "./types";

/**
 * Entfernt Insights mit identischer `id` (sollte durch die Detektoren selbst
 * nicht vorkommen, ist aber eine billige Absicherung, falls zwei Regeln
 * versehentlich dieselbe Tatsache doppelt melden) und sortiert deterministisch
 * nach Priorität, bei Gleichstand nach `detectedAt`, dann nach `id` (stabil,
 * nie von Objekt-Erzeugungsreihenfolge abhängig).
 */
export function dedupeAndSortInsights(insights: Insight[]): Insight[] {
  const byId = new Map<string, Insight>();
  for (const insight of insights) {
    if (!byId.has(insight.id)) byId.set(insight.id, insight);
  }

  return Array.from(byId.values()).sort((a, b) => {
    const priorityDiff = INSIGHT_PRIORITY_ORDER[a.priority] - INSIGHT_PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const timeDiff = a.detectedAt.getTime() - b.detectedAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });
}

/** Filtert Insights heraus, deren stabile id bereits als dismissed gespeichert ist. */
export function excludeDismissed(insights: Insight[], dismissedKeys: Set<string> | string[]): Insight[] {
  const dismissed = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys);
  return insights.filter((i) => !dismissed.has(i.id));
}

/** Nur Insights, die auf dieser Surface angezeigt werden dürfen. */
export function forSurface(insights: Insight[], surface: Insight["surfaces"][number]): Insight[] {
  return insights.filter((i) => i.surfaces.includes(surface));
}
