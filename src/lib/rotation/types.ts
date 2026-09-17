export type RotationUrgency = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export type RecommendedAction = "USE_FIRST" | "USE_SOON" | "PLAN_MEAL" | "KEEP" | "CHECK" | "NO_ACTION";

export type ExpirationDateTypeValue = "EXACT" | "ESTIMATED" | "UNKNOWN";

/** Provider-neutrale Eingabe, entkoppelt von der konkreten Prisma-Zeile (siehe pantryMapping.ts). */
export interface RotationItemInput {
  id: string;
  name: string;
  opened: boolean;
  cooked: boolean;
  quantity: number;
  remainingQuantity: number;
  expirationDate: Date | null;
  expirationDateType: ExpirationDateTypeValue;
  purchaseDate: Date | null;
  location: string;
}

/**
 * Strukturiertes Ergebnis pro Pantry Item. `reasons` erklären, warum ein
 * Item priorisiert wurde, `warnings` sind eigenständige Hinweise (aktuell:
 * abgelaufen), die NIE eine Aussage zur Genusstauglichkeit treffen, siehe
 * rotationEngine.ts.
 */
export interface RotationResult {
  pantryItemId: string;
  priorityScore: number;
  urgency: RotationUrgency;
  reasons: string[];
  warnings: string[];
  recommendedAction: RecommendedAction;
}
