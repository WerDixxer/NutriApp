import { decideForMe } from "./decideForMe";
import type { AssistantQuery } from "./assistantQuery";

export interface DecisionEngineInput {
  profileId: string;
  now?: Date;
  /** Zusätzlicher Kontext aus dem Assistant-Gespräch, z.B. explizit genannte Kalorien. Optional, wird von der v1-Engine noch nicht ausgewertet. */
  query?: AssistantQuery;
}

export interface DecisionEngineResult {
  itemId: string;
  slot: string;
  time: string;
  recipeId: string;
  portionMultiplier: number;
  reason: string;
}

/**
 * Schnittstelle für "Entscheide für mich" (Zero Decision Mode, Kapitel 4).
 * Der Aufrufer (Food Assistant, später ein UI-Button) kennt nur dieses
 * Interface, nie die konkrete Implementierung, damit Kapitel 4 die Engine
 * austauschen kann, ohne Aufrufer anzufassen.
 */
export interface DecisionEngine {
  readonly name: string;
  /** Gibt `null` zurück, wenn es nichts mehr zu entscheiden gibt (z.B. Tag bereits vollständig geloggt). */
  decide(input: DecisionEngineInput): Promise<DecisionEngineResult | null>;
}

/**
 * v1: entscheidet ausschließlich anhand des bereits generierten Tagesplans
 * (zeitlich nächste, noch nicht geloggte Mahlzeit). Berücksichtigt noch
 * NICHT: Pantry/Haltbarkeit, Budget, Abwechslung über mehrere Tage, explizite
 * Kalorien-/Makro-Wünsche aus dem Gespräch, konfigurierbare Priorisierung.
 * Das ist bewusst die volle Multi-Faktor-Engine aus Kapitel 4, hier nur die
 * Schnittstelle + eine ehrliche, tatsächlich funktionierende v1-Umsetzung.
 */
export class SimpleDecisionEngine implements DecisionEngine {
  readonly name = "simple-plan-based";

  async decide(input: DecisionEngineInput): Promise<DecisionEngineResult | null> {
    const decision = await decideForMe(input.profileId, input.now);
    if (!decision) return null;
    return {
      itemId: decision.itemId,
      slot: decision.slot,
      time: decision.time,
      recipeId: decision.recipeId,
      portionMultiplier: decision.portionMultiplier,
      reason: decision.reason,
    };
  }
}

let cached: DecisionEngine | null = null;

export function getDecisionEngine(): DecisionEngine {
  if (!cached) cached = new SimpleDecisionEngine();
  return cached;
}
