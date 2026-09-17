import { OpenFoodFactsProvider } from "./openFoodFactsProvider";

/**
 * Provider-neutrale Schnittstelle für externe Nährwert-/Produktdatenbanken
 * (z.B. für den späteren Barcode Scanner, Kapitel 17). Analog zu
 * `LLMProvider` (`src/lib/agents/llmProvider.ts`): der Rest der App sieht
 * nie provider-spezifische Typen, nur `NutritionProviderProduct`.
 */
export interface NutritionProviderProduct {
  source: string;
  barcode: string;
  name: string;
  brand?: string;
  imageUrl?: string;
  /** z.B. "400 g" - Herstellerangabe, keine strukturierte Menge. */
  servingSize?: string;
  /** Nährwerte je 100 g/ml, so wie es die meisten Produktdatenbanken führen. */
  per100g: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
    sugarG?: number;
    saturatedFatG?: number;
    sodiumMg?: number;
  };
}

export interface NutritionProvider {
  readonly name: string;
  /** Gibt `null` zurück, wenn der Barcode nicht gefunden wurde oder die Daten zu unvollständig sind (kein kcal-Wert). */
  lookupBarcode(barcode: string): Promise<NutritionProviderProduct | null>;
}

export class NutritionProviderConfigError extends Error {}

let cached: NutritionProvider | null = null;

export function getNutritionProvider(): NutritionProvider {
  if (cached) return cached;

  const providerName = process.env.NUTRITION_PROVIDER || "openfoodfacts";

  switch (providerName) {
    case "openfoodfacts":
      cached = new OpenFoodFactsProvider();
      return cached;
    default:
      throw new NutritionProviderConfigError(
        `Unbekannter NUTRITION_PROVIDER "${providerName}". Unterstützt: "openfoodfacts".`,
      );
  }
}
