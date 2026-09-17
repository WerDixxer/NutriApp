import Anthropic from "@anthropic-ai/sdk";
import {
  LLMConfigError,
  type ContentBlock,
  type LLMChatParams,
  type LLMMessage,
  type LLMProvider,
  type LLMResponse,
  type ToolChoice,
} from "./llmProvider";

const DEFAULT_MODEL = "claude-sonnet-5";

function toAnthropicContent(content: string | ContentBlock[]): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  return content.map((block): Anthropic.ContentBlockParam => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      };
    }
    return {
      type: "tool_result",
      tool_use_id: block.toolUseId,
      content: block.content,
      is_error: block.isError,
    };
  });
}

function toLLMMessage(msg: LLMMessage): Anthropic.MessageParam {
  return { role: msg.role, content: toAnthropicContent(msg.content) };
}

function toAnthropicToolChoice(choice?: ToolChoice): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice.type === "tool") return { type: "tool", name: choice.name };
  return { type: choice.type };
}

function fromAnthropicContent(blocks: Anthropic.ContentBlock[]): ContentBlock[] {
  return blocks.map((block): ContentBlock => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "tool_use") {
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    }
    // Andere Blocktypen (z.B. thinking) werden für unsere Zwecke als Text ignoriert.
    return { type: "text", text: "" };
  });
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  private getClient(): Anthropic {
    if (this.client) return this.client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new LLMConfigError(
        "ANTHROPIC_API_KEY fehlt. Trag deinen Anthropic API Key in die lokale .env-Datei ein (siehe .env.example).",
      );
    }
    this.client = new Anthropic({ apiKey });
    return this.client;
  }

  async chat(params: LLMChatParams): Promise<LLMResponse> {
    const client = this.getClient();
    const model = process.env.LLM_MODEL || DEFAULT_MODEL;

    const response = await client.messages.create({
      model,
      max_tokens: params.maxTokens ?? 1024,
      system: params.system,
      messages: params.messages.map(toLLMMessage),
      tools: params.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
      tool_choice: toAnthropicToolChoice(params.toolChoice),
    });

    return {
      content: fromAnthropicContent(response.content),
      stopReason: response.stop_reason ?? "end_turn",
    };
  }
}
