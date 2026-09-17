import { describe, expect, it, vi } from "vitest";
import type { LLMChatParams, LLMResponse } from "./llmProvider";

const chatMock = vi.fn<(params: LLMChatParams) => Promise<LLMResponse>>();

vi.mock("./llmProvider", () => ({
  getLLMProvider: () => ({ name: "mock", chat: chatMock }),
}));

const { extractAssistantQuery } = await import("./queryExtraction");

describe("extractAssistantQuery", () => {
  it("returns the zod-validated extraction when the LLM calls the tool correctly", async () => {
    chatMock.mockResolvedValueOnce({
      stopReason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "1",
          name: "extract_query",
          input: { intent: "SEARCH_RECIPES", query: { calories: 600, protein: 40 } },
        },
      ],
    });

    const result = await extractAssistantQuery("Ich brauche etwas mit 600 kcal und 40g Protein.", []);

    expect(result.intent).toBe("SEARCH_RECIPES");
    expect(result.query.calories).toBe(600);
    expect(result.query.protein).toBe(40);
  });

  it("forces the extract_query tool via toolChoice", async () => {
    chatMock.mockResolvedValueOnce({
      stopReason: "tool_use",
      content: [{ type: "tool_use", id: "1", name: "extract_query", input: { intent: "OTHER", query: {} } }],
    });

    await extractAssistantQuery("Hallo", []);

    expect(chatMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolChoice: { type: "tool", name: "extract_query" } }),
    );
  });

  it("falls back to OTHER when the LLM does not call the tool", async () => {
    chatMock.mockResolvedValueOnce({ stopReason: "end_turn", content: [{ type: "text", text: "Hallo!" }] });
    const result = await extractAssistantQuery("Hallo", []);
    expect(result).toEqual({ intent: "OTHER", query: {} });
  });

  it("falls back to OTHER when the tool input fails zod validation", async () => {
    chatMock.mockResolvedValueOnce({
      stopReason: "tool_use",
      content: [{ type: "tool_use", id: "1", name: "extract_query", input: { intent: "NOT_A_REAL_INTENT" } }],
    });
    const result = await extractAssistantQuery("Irgendwas", []);
    expect(result).toEqual({ intent: "OTHER", query: {} });
  });
});
