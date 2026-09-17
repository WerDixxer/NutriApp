/**
 * Provider-Schnittstelle für Bilderkennung (Kühlschrank-/Lebensmittelfoto ->
 * erkannte Zutaten, Kapitel 24). Noch keine Implementierung: Anthropics
 * Messages API unterstützt Bild-Input bereits nativ, `AnthropicProvider`
 * (`src/lib/agents/anthropicProvider.ts`) müsste dafür nur um Bild-Content-
 * Blocks erweitert werden, ein separater Dienst ist nicht zwingend nötig.
 * Interface hier trotzdem provider-neutral gehalten, falls später ein
 * dediziertes Vision-Modell (z.B. für höhere Erkennungsgenauigkeit bei
 * Barcodes/Etiketten) sinnvoller ist.
 */
export interface DetectedIngredient {
  label: string;
  confidence: number;
  quantityHint?: string;
}

export interface VisionProvider {
  readonly name: string;
  detectIngredients(imageBase64: string, mimeType: string): Promise<DetectedIngredient[]>;
}

export class VisionProviderConfigError extends Error {}
