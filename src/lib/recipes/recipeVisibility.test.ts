import { describe, expect, it } from "vitest";
import { isRecipeVisibleTo, recipesVisibleTo } from "./recipeVisibility";

describe("Rezept-Sichtbarkeit (R5F-2)", () => {
  it.each([
    ["Katalogrezept", { isCustom: false, ownerProfileId: null }, true],
    ["eigenes Rezept", { isCustom: true, ownerProfileId: "profile-A" }, true],
    ["fremdes privates Rezept", { isCustom: true, ownerProfileId: "profile-B" }, false],
    ["eigenes Rezept ohne Besitzer (verwaist)", { isCustom: true, ownerProfileId: null }, false],
  ])("%s ist für profile-A sichtbar: %s", (_label, recipe, visible) => {
    expect(isRecipeVisibleTo(recipe, "profile-A")).toBe(visible);
  });

  it("die Abfrage drückt dieselbe Regel aus: Katalog oder eigenes Rezept", () => {
    expect(recipesVisibleTo("profile-A")).toEqual({ OR: [{ isCustom: false }, { ownerProfileId: "profile-A" }] });
  });
});
