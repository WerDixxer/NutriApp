import { getExpirationStatus } from "../pantry/expiration";
import { scoreAge, scoreExpiration, scoreLocation, scoreOpenedCooked, scoreRemainingQuantity } from "./factors";
import { URGENCY_THRESHOLDS } from "./weights";
import type { RecommendedAction, RotationItemInput, RotationResult, RotationUrgency } from "./types";

function determineUrgency(priorityScore: number, hasAnySignal: boolean): RotationUrgency {
  if (priorityScore >= URGENCY_THRESHOLDS.critical) return "CRITICAL";
  if (priorityScore >= URGENCY_THRESHOLDS.high) return "HIGH";
  if (priorityScore >= URGENCY_THRESHOLDS.medium) return "MEDIUM";
  if (priorityScore > 0) return "LOW";
  // Score 0 UND kein einziges Signal (kein Ablaufdatum, nicht geöffnet, nicht
  // gekocht, kein Kaufdatum): die Engine hat schlicht keine Grundlage für
  // eine Einschätzung. Das ist etwas anderes als "geprüft und unauffällig".
  return hasAnySignal ? "LOW" : "UNKNOWN";
}

/**
 * `isExpired` erzwingt IMMER `CHECK`, nie `USE_FIRST`: die Engine stellt nur
 * fest, dass das Ablaufdatum überschritten ist, sie behauptet nie, dass das
 * Item noch (oder nicht mehr) genusstauglich ist (Kapitel-Auftrag Abschnitt
 * 11). Alles andere leitet sich aus der Dringlichkeitsstufe plus den
 * konkreten Signalen ab, die "warum" begründen (gekocht/geöffnet/kleine
 * Restmenge -> eher "jetzt verwenden" als nur "bald einplanen").
 */
function determineRecommendedAction(
  urgency: RotationUrgency,
  isExpired: boolean,
  item: RotationItemInput,
  hasSmallRemaining: boolean,
): RecommendedAction {
  if (isExpired) return "CHECK";
  if (urgency === "CRITICAL" || urgency === "HIGH") {
    return item.cooked || item.opened || hasSmallRemaining ? "USE_FIRST" : "USE_SOON";
  }
  if (urgency === "MEDIUM") return "PLAN_MEAL";
  if (urgency === "LOW") return "KEEP";
  return "NO_ACTION";
}

/**
 * Reine, deterministische Kernfunktion (kein DB-Zugriff): kombiniert alle
 * Rotation-Faktoren zu einem priorityScore, leitet daraus urgency und
 * recommendedAction ab und sammelt reasons/warnings ausschließlich aus den
 * Faktoren, die tatsächlich etwas beigetragen haben. Gleiche Eingabe (inkl.
 * `now`) liefert immer dasselbe Ergebnis.
 */
export function computeRotationResult(item: RotationItemInput, now: Date = new Date()): RotationResult {
  const status = getExpirationStatus(item.expirationDate, now);

  const expiration = scoreExpiration(item, status);
  const openedCooked = scoreOpenedCooked(item);
  const remaining = scoreRemainingQuantity(item);
  const age = scoreAge(item, now);
  const location = scoreLocation(item);

  const allFactors = [expiration, ...openedCooked, remaining, age, location];
  const priorityScore = Math.round(allFactors.reduce((sum, f) => sum + f.points, 0) * 10) / 10;

  const reasons = allFactors.filter((f): f is typeof f & { reason: string } => !!f.reason).map((f) => f.reason);
  const warnings = allFactors.filter((f): f is typeof f & { warning: string } => !!f.warning).map((f) => f.warning);

  const hasAnySignal = item.opened || item.cooked || item.purchaseDate !== null || item.expirationDate !== null;
  const urgency = determineUrgency(priorityScore, hasAnySignal);
  const recommendedAction = determineRecommendedAction(urgency, status.isExpired, item, remaining.points > 0);

  return {
    pantryItemId: item.id,
    priorityScore,
    urgency,
    reasons,
    warnings,
    recommendedAction,
  };
}

/**
 * Berechnet die Priorität für eine ganze Pantry-Liste im Speicher (keine
 * DB-Abfrage pro Item, siehe Kapitel-Auftrag Abschnitt 14) und sortiert
 * deterministisch absteigend nach priorityScore, bei exaktem Gleichstand
 * nach `pantryItemId`.
 */
export function prioritizePantryItems(items: RotationItemInput[], now: Date = new Date()): RotationResult[] {
  const results = items.map((item) => computeRotationResult(item, now));
  results.sort((a, b) => b.priorityScore - a.priorityScore || a.pantryItemId.localeCompare(b.pantryItemId));
  return results;
}

/**
 * Gruppierung für die UI/andere Module: "Zuerst verbrauchen" (inkl. Items,
 * die geprüft werden müssen) vs. "Bald einplanen". Reine Funktion, damit
 * weder die API-Route noch die UI-Komponente diese Logik selbst nachbauen.
 */
export function groupRotationResultsForDisplay(results: RotationResult[]): {
  useFirst: RotationResult[];
  planMeal: RotationResult[];
} {
  return {
    useFirst: results.filter((r) => r.recommendedAction === "USE_FIRST" || r.recommendedAction === "USE_SOON" || r.recommendedAction === "CHECK"),
    planMeal: results.filter((r) => r.recommendedAction === "PLAN_MEAL"),
  };
}
