import { AnthropicProvider } from "./anthropicProvider";

/**
 * Provider-neutrale Schnittstelle für LLM-Aufrufe. Jeder Provider (Anthropic,
 * später z.B. OpenAI) implementiert `LLMProvider` gegen dieses gemeinsame
 * Content-Block-Format, sodass der Rest des Codes (foodAssistant.ts etc.)
 * nie provider-spezifische Typen sieht. Providerwechsel = neue Datei +
 * Eintrag in `getLLMProvider()`, kein Anfassen der Agent-Logik.
 */

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LLMMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON-Schema (wie von Anthropic/OpenAI Function-Calling erwartet). */
  inputSchema: Record<string, unknown>;
}

/**
 * Provider-neutrale Tool-Choice: `auto` (Standard, LLM entscheidet frei),
 * `any` (muss irgendein Tool aufrufen) oder `tool` (muss genau dieses Tool
 * aufrufen, z.B. für erzwungene strukturierte Extraktion). Deckt sich mit
 * Anthropics `tool_choice` und ist analog zu OpenAIs `tool_choice`-Format,
 * damit ein Providerwechsel diesen Teil nicht anfassen muss.
 */
export type ToolChoice = { type: "auto" } | { type: "any" } | { type: "tool"; name: string };

export interface LLMChatParams {
  system: string;
  messages: LLMMessage[];
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  maxTokens?: number;
}

export interface LLMResponse {
  content: ContentBlock[];
  stopReason: "tool_use" | "end_turn" | "max_tokens" | string;
}

export interface LLMProvider {
  readonly name: string;
  chat(params: LLMChatParams): Promise<LLMResponse>;
}

export class LLMConfigError extends Error {}

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;

  const providerName = process.env.LLM_PROVIDER || "anthropic";

  switch (providerName) {
    case "anthropic":
      cached = new AnthropicProvider();
      return cached;
    default:
      throw new LLMConfigError(
        `Unbekannter LLM_PROVIDER "${providerName}". Unterstützt: "anthropic".`,
      );
  }
}
