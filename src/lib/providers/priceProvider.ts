/**
 * Provider-Schnittstelle für Lebensmittelpreise (Kapitel 8: Food Budget,
 * Kapitel 24: Food Cost per Meal). Noch keine Implementierung: es gibt
 * aktuell keine kostenlose, verlässliche deutsche Lebensmittelpreis-API
 * (siehe Chapter-0-Analyse, Punkt N). Bis eine echte Quelle angebunden ist,
 * arbeitet das Budget-Feature mit vom Nutzer selbst eingetragenen/
 * geschätzten Preisen statt einer Fake-Integration.
 */
export interface PriceLookupResult {
  source: string;
  query: string;
  estimatedPriceEur: number;
  unit: string;
  asOf: string;
}

export interface PriceProvider {
  readonly name: string;
  lookupPrice(query: string): Promise<PriceLookupResult | null>;
}

export class PriceProviderConfigError extends Error {}
