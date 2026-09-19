import { describe, expect, it } from "vitest";
import { dedupeAndSortInsights, excludeDismissed, forSurface } from "./dedupe";
import type { Insight } from "./types";

const now = new Date("2026-09-18T12:00:00Z");

function insight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: "insight-1",
    type: "PANTRY_EXPIRING_SOON",
    category: "PANTRY",
    priority: "useful",
    message: "Test",
    context: {},
    source: { entity: "PantryItem", id: "p1" },
    surfaces: ["DASHBOARD"],
    detectedAt: now,
    expiresAt: null,
    ...overrides,
  };
}

describe("dedupeAndSortInsights", () => {
  it("entfernt Einträge mit identischer id", () => {
    const result = dedupeAndSortInsights([insight({ id: "a" }), insight({ id: "a" }), insight({ id: "b" })]);
    expect(result).toHaveLength(2);
  });

  it("sortiert nach Priorität: critical vor important vor useful vor informational", () => {
    const result = dedupeAndSortInsights([
      insight({ id: "a", priority: "informational" }),
      insight({ id: "b", priority: "critical" }),
      insight({ id: "c", priority: "useful" }),
      insight({ id: "d", priority: "important" }),
    ]);
    expect(result.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("sortiert bei gleicher Priorität deterministisch nach detectedAt, dann nach id", () => {
    const earlier = new Date(now.getTime() - 1000);
    const result = dedupeAndSortInsights([
      insight({ id: "z", priority: "useful", detectedAt: now }),
      insight({ id: "a", priority: "useful", detectedAt: earlier }),
    ]);
    expect(result.map((i) => i.id)).toEqual(["a", "z"]);
  });
});

describe("excludeDismissed", () => {
  it("filtert abgewiesene Insights per stabiler id heraus", () => {
    const result = excludeDismissed([insight({ id: "a" }), insight({ id: "b" })], new Set(["a"]));
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("lässt alles durch, wenn nichts abgewiesen wurde", () => {
    const result = excludeDismissed([insight({ id: "a" })], new Set());
    expect(result).toHaveLength(1);
  });
});

describe("forSurface", () => {
  it("liefert nur Insights, die die angefragte Surface tragen", () => {
    const result = forSurface(
      [insight({ id: "a", surfaces: ["DASHBOARD"] }), insight({ id: "b", surfaces: ["PANTRY"] })],
      "PANTRY",
    );
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });
});
