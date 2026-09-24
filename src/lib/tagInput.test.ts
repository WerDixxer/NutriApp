import { describe, expect, it, vi } from "vitest";
import { redirectFieldClickToInput } from "./tagInput";

type Target = "empty" | "chip-text" | "input" | "x:Milch" | "x:Reis";

/** Was `closest("button, input")` für das angeklickte Element liefert. */
function fakeTarget(target: Target) {
  const interactive = target === "input" || target.startsWith("x:");
  return { closest: (selector: string) => (interactive && selector === "button, input" ? {} : null) };
}

/**
 * Minimales Modell des Browserablaufs für ein TagInput in einem <label> (OnboardingForm):
 *  1. Click-Handler des Feldes (wie in TagInput.tsx),
 *  2. Standardaktion des Labels, falls der Klick nicht abgebrochen wurde und nicht selbst
 *     auf einem bedienbaren Element lag: ein zweiter Klick auf den ersten Button im Label
 *     (= X des ersten Chips).
 * Der X-Button entfernt seinen Chip. Das echte DOM prüft der manuelle Browser-Test.
 */
function clickInLabel(values: string[], target: Target) {
  let tags = [...values];
  const focusInput = vi.fn();
  const removeChip = (label: string) => {
    tags = tags.filter((v) => v !== label);
  };

  let defaultPrevented = false;
  const event = {
    target: fakeTarget(target),
    preventDefault: vi.fn(() => {
      defaultPrevented = true;
    }),
  };

  if (target.startsWith("x:")) removeChip(target.slice(2)); // onClick des X-Buttons
  if (redirectFieldClickToInput(event)) focusInput(); // onClick des Feldes

  const interactive = target === "input" || target.startsWith("x:");
  if (!defaultPrevented && !interactive && tags.length > 0) removeChip(tags[0]); // Label-Aktivierung

  return { tags, focusInput, event };
}

describe("Klick im TagInput-Feld (Regression: Klick auf leere Fläche löschte den ersten Chip)", () => {
  it("Klick auf die leere Fläche: 'Milch' bleibt erhalten und der Input wird fokussiert", () => {
    const { tags, focusInput, event } = clickInLabel(["Milch"], "empty");
    expect(tags).toEqual(["Milch"]);
    expect(focusInput).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Klick neben einem Chip (Chip-Text): kein Chip wird gelöscht, auch nicht der erste", () => {
    const { tags, focusInput } = clickInLabel(["Milch", "Reis"], "chip-text");
    expect(tags).toEqual(["Milch", "Reis"]);
    expect(focusInput).toHaveBeenCalledTimes(1);
  });

  it("Klick auf den Input: kein Chip wird gelöscht, die Standardaktion des Browsers bleibt unberührt", () => {
    const { tags, focusInput, event } = clickInLabel(["Milch"], "input");
    expect(tags).toEqual(["Milch"]);
    expect(focusInput).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("Klick auf das X von 'Milch' entfernt weiterhin genau diesen Chip", () => {
    const { tags, event } = clickInLabel(["Milch"], "x:Milch");
    expect(tags).toEqual([]);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("Klick auf das X eines späteren Chips entfernt nur diesen, nicht den ersten", () => {
    expect(clickInLabel(["Milch", "Reis"], "x:Reis").tags).toEqual(["Milch"]);
  });

  it("ein Ziel ohne closest (z. B. Textknoten) wird wie eine leere Fläche behandelt", () => {
    const event = { target: null, preventDefault: vi.fn() };
    expect(redirectFieldClickToInput(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
