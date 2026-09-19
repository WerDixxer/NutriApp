import { describe, expect, it } from "vitest";
import { matchContextField } from "./contextMatching";

describe("matchContextField", () => {
  it("liefert EXACT_MATCH bei identischen (normalisierten) Werten", () => {
    expect(matchContextField("resistance", "resistance")).toBe("EXACT_MATCH");
    expect(matchContextField("  Resistance ", "resistance")).toBe("EXACT_MATCH");
    expect(matchContextField("ENDURANCE", "endurance")).toBe("EXACT_MATCH");
  });

  it("liefert PARTIAL_MATCH, wenn ein Wert im anderen enthalten ist", () => {
    expect(matchContextField("resistance", "resistance training, 40-min Bout")).toBe("PARTIAL_MATCH");
    expect(matchContextField("Ausdauersportler", "Ausdauersportler; überwiegend männlich")).toBe("PARTIAL_MATCH");
  });

  it("liefert GENERAL, wenn der Claim das Feld nicht einschränkt (null)", () => {
    expect(matchContextField("resistance", null)).toBe("GENERAL");
    expect(matchContextField(undefined, null)).toBe("GENERAL");
  });

  it("liefert UNKNOWN, wenn der Kontext keinen Wert liefert, auch wenn der Claim einen hat", () => {
    expect(matchContextField(undefined, "endurance")).toBe("UNKNOWN");
    expect(matchContextField("", "endurance")).toBe("UNKNOWN");
  });

  it("liefert CONFLICT, wenn beide Werte gesetzt sind und sich nicht überschneiden", () => {
    expect(matchContextField("resistance", "endurance")).toBe("CONFLICT");
    expect(matchContextField("45 min", "≥70% VO2max, >90 min")).toBe("CONFLICT");
    expect(matchContextField("post-exercise", "pre-exercise")).toBe("CONFLICT");
  });

  it("behandelt fehlenden Kontext NIE als Match (weder positiv noch negativ)", () => {
    expect(matchContextField(undefined, "endurance")).not.toBe("EXACT_MATCH");
    expect(matchContextField(undefined, "endurance")).not.toBe("PARTIAL_MATCH");
    expect(matchContextField(undefined, "endurance")).not.toBe("CONFLICT");
  });
});
