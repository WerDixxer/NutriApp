import { describe, expect, it, vi } from "vitest";
import type { Decision } from "./decideForMe";

const decideForMeMock = vi.fn<(profileId: string, now?: Date) => Promise<Decision | null>>();

vi.mock("./decideForMe", () => ({
  decideForMe: (profileId: string, now?: Date) => decideForMeMock(profileId, now),
}));

const { SimpleDecisionEngine } = await import("./decisionEngine");

describe("SimpleDecisionEngine", () => {
  it("maps a Decision from decideForMe onto DecisionEngineResult", async () => {
    decideForMeMock.mockResolvedValueOnce({
      itemId: "item-1",
      slot: "LUNCH",
      time: "13:00",
      recipeId: "recipe-1",
      portionMultiplier: 1.2,
      reason: "Genau jetzt an der Reihe.",
    });

    const engine = new SimpleDecisionEngine();
    const result = await engine.decide({ profileId: "profile-1" });

    expect(result).toEqual({
      itemId: "item-1",
      slot: "LUNCH",
      time: "13:00",
      recipeId: "recipe-1",
      portionMultiplier: 1.2,
      reason: "Genau jetzt an der Reihe.",
    });
  });

  it("passes null through when there is nothing left to decide", async () => {
    decideForMeMock.mockResolvedValueOnce(null);
    const engine = new SimpleDecisionEngine();
    expect(await engine.decide({ profileId: "profile-1" })).toBeNull();
  });
});
