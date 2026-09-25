import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AnthropicProvider (F-20): explizites Timeout und höchstens 1 Wiederholung statt der SDK-Standards
 * (10 Minuten, 2 Wiederholungen); ein Timeout wird zu LLMTimeoutError. Das SDK ist ersetzt - es
 * wird nur geprüft, womit VYN es konfiguriert und wie Fehler übersetzt werden.
 */
const sdk = vi.hoisted(() => ({
  constructorOptions: [] as Record<string, unknown>[],
  create: vi.fn(),
}));
vi.mock("@anthropic-ai/sdk", () => {
  class APIConnectionTimeoutError extends Error {}
  class FakeAnthropic {
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    messages = { create: sdk.create };
    constructor(options: Record<string, unknown>) {
      sdk.constructorOptions.push(options);
    }
  }
  return { default: FakeAnthropic };
});

const { AnthropicProvider, LLM_MAX_RETRIES, LLM_REQUEST_TIMEOUT_MS } = await import("./anthropicProvider");
const { LLMTimeoutError } = await import("./llmProvider");
const Anthropic = (await import("@anthropic-ai/sdk")).default as unknown as { APIConnectionTimeoutError: new (message?: string) => Error };

const params = { system: "Test", messages: [{ role: "user" as const, content: "Hallo" }] };

const originalApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  sdk.constructorOptions.length = 0;
  sdk.create.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("AnthropicProvider", () => {
  it("konfiguriert das SDK mit 30 s Timeout und höchstens 1 Wiederholung", async () => {
    sdk.create.mockResolvedValueOnce({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    await new AnthropicProvider().chat(params);

    expect(LLM_REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(LLM_MAX_RETRIES).toBe(1);
    expect(sdk.constructorOptions).toEqual([{ apiKey: "test-key", timeout: 30_000, maxRetries: 1 }]);
  });

  it("macht pro chat()-Aufruf genau einen SDK-Aufruf (Wiederholungen nur im SDK, begrenzt auf 1)", async () => {
    sdk.create.mockResolvedValue({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" });
    const provider = new AnthropicProvider();
    await provider.chat(params);
    await provider.chat(params);

    expect(sdk.create).toHaveBeenCalledTimes(2);
  });

  it("übersetzt ein Timeout des SDK in LLMTimeoutError ohne Provider-Details", async () => {
    sdk.create.mockRejectedValueOnce(new Anthropic.APIConnectionTimeoutError("Request timed out."));
    const error = await new AnthropicProvider().chat(params).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LLMTimeoutError);
    expect((error as Error).message).not.toMatch(/anthropic|claude/i);
  });

  it("reicht andere Fehler unverändert weiter", async () => {
    const failure = new Error("overloaded");
    sdk.create.mockRejectedValueOnce(failure);
    await expect(new AnthropicProvider().chat(params)).rejects.toBe(failure);
  });
});
