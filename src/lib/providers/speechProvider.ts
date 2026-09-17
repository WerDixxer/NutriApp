/**
 * Provider-Schnittstelle für Sprache (Kapitel 25: Voice Input -> Speech-to-
 * Text -> Food Assistant, optional Text-to-Speech für Vorlesen im Senior
 * Cooking Mode). Noch keine Implementierung, Anbieter noch nicht entschieden.
 */
export interface SpeechToTextProvider {
  readonly name: string;
  transcribe(audioBase64: string, mimeType: string): Promise<string>;
}

export interface TextToSpeechProvider {
  readonly name: string;
  synthesize(text: string): Promise<{ audioBase64: string; mimeType: string }>;
}

export class SpeechProviderConfigError extends Error {}
