import { describe, expect, it } from "vitest";
import { computeRotationPriority } from "./rotationPriority";

const now = new Date("2026-09-17T12:00:00Z");

const base = { opened: false, cooked: false, expirationDate: null, purchaseDate: null };

describe("computeRotationPriority", () => {
  it("gives an expired item the highest urgency", () => {
    const result = computeRotationPriority({ ...base, expirationDate: new Date("2026-09-10") }, now);
    expect(result.urgency).toBe("HIGH");
    expect(result.reasons).toContain("Ablaufdatum überschritten.");
  });

  it("ranks an expired item above an item that is merely opened", () => {
    const expired = computeRotationPriority({ ...base, expirationDate: new Date("2026-09-10") }, now);
    const opened = computeRotationPriority({ ...base, opened: true }, now);
    expect(expired.score).toBeGreaterThan(opened.score);
  });

  it("ranks an opened item above an unopened item with no other signals", () => {
    const opened = computeRotationPriority({ ...base, opened: true }, now);
    const untouched = computeRotationPriority(base, now);
    expect(opened.score).toBeGreaterThan(untouched.score);
  });

  it("ranks a cooked item above an untouched item", () => {
    const cooked = computeRotationPriority({ ...base, cooked: true }, now);
    const untouched = computeRotationPriority(base, now);
    expect(cooked.score).toBeGreaterThan(untouched.score);
  });

  it("flags a long-present item even without an expiration date", () => {
    const result = computeRotationPriority({ ...base, purchaseDate: new Date("2026-08-01") }, now);
    expect(result.reasons).toContain("Schon länger vorhanden.");
  });

  it("gives an untouched, freshly bought item with no expiration date the lowest urgency", () => {
    const result = computeRotationPriority({ ...base, purchaseDate: new Date("2026-09-16") }, now);
    expect(result.urgency).toBe("LOW");
  });

  it("combines multiple signals into a higher score than any single one alone", () => {
    const combined = computeRotationPriority(
      { opened: true, cooked: true, expirationDate: new Date("2026-09-18"), purchaseDate: new Date("2026-09-01") },
      now,
    );
    const openedOnly = computeRotationPriority({ ...base, opened: true }, now);
    expect(combined.score).toBeGreaterThan(openedOnly.score);
  });

  it("is sortable: HIGH > MEDIUM > LOW by score", () => {
    const high = computeRotationPriority({ ...base, expirationDate: new Date("2026-09-10") }, now);
    const medium = computeRotationPriority({ ...base, opened: true }, now);
    const low = computeRotationPriority(base, now);
    const sorted = [low, high, medium].sort((a, b) => b.score - a.score);
    expect(sorted.map((r) => r.urgency)).toEqual(["HIGH", "MEDIUM", "LOW"]);
  });
});
