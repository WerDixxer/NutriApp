import { describe, expect, it } from "vitest";
import { buildSummary } from "./explain";
import type { AggregatedIngredient, PrepGroup, SoloRecipe } from "./types";

describe("buildSummary: nur tatsächlich berechnete Aussagen", () => {
  it("nennt die Kochvorgang-Reduktion, wenn sie tatsächlich eintritt", () => {
    const lines = buildSummary(5, 2, [], [], []);
    expect(lines[0]).toBe("2 Kochvorgänge statt 5.");
  });

  it("behauptet KEINE Reduktion, wenn keine stattgefunden hat", () => {
    const lines = buildSummary(5, 5, [], [], []);
    expect(lines[0]).not.toContain("statt");
  });

  it("nennt keine Zeitersparnis in Minuten (Abschnitt 24) - nur die Anzahl gesparter Kochvorgänge", () => {
    const lines = buildSummary(5, 2, [], [], []);
    for (const line of lines) {
      expect(line).not.toMatch(/Minute/i);
    }
  });

  it("nennt eine Prep-Gruppe mit ihrer Zutatenzahl und Mahlzeitenzahl", () => {
    const group: PrepGroup = {
      id: "prep-1",
      name: "Batch: Hähnchen + Reis",
      tasks: [
        { ingredientKey: "hähnchen", displayName: "Hähnchen", totalQuantity: 750, unit: "G", usedForMeals: [{ mealId: "m1", date: new Date(), slot: "LUNCH", recipeId: "r1", recipeName: "X", quantityForMeal: 200 }], pantry: null },
        { ingredientKey: "reis", displayName: "Reis", totalQuantity: 600, unit: "G", usedForMeals: [{ mealId: "m2", date: new Date(), slot: "DINNER", recipeId: "r2", recipeName: "Y", quantityForMeal: 300 }], pantry: null },
      ],
      sourceRecipeIds: ["r1", "r2"],
      earliestNeededDate: new Date(),
      latestNeededDate: new Date(),
      combinedPrepTimeMin: 40,
    };
    const lines = buildSummary(2, 1, [group], [], []);
    expect(lines.some((l) => l.includes("Batch: Hähnchen + Reis") && l.includes("2 Zutaten"))).toBe(true);
  });

  it("nennt eine aus dem Vorrat verwendete Zutat nur, wenn tatsächlich Pantry-Bestand vorhanden ist", () => {
    const withPantry: AggregatedIngredient[] = [
      { key: "spinat::G", normalizedName: "spinat", displayName: "Spinat", unit: "G", totalQuantity: 500, recipeCount: 2, sourceMeals: [], pantry: { availableQuantity: 450, urgency: "HIGH" }, costCents: null },
    ];
    const lines = buildSummary(2, 1, [], [], withPantry);
    expect(lines.some((l) => l.includes("450") && l.includes("Spinat"))).toBe(true);
  });

  it("erwähnt Food-Waste-Reduktion nur bei tatsächlich dringenden Pantry-Items", () => {
    const urgent: AggregatedIngredient[] = [
      { key: "spinat::G", normalizedName: "spinat", displayName: "Spinat", unit: "G", totalQuantity: 500, recipeCount: 2, sourceMeals: [], pantry: { availableQuantity: 450, urgency: "CRITICAL" }, costCents: null },
    ];
    const calm: AggregatedIngredient[] = [
      { key: "reis::G", normalizedName: "reis", displayName: "Reis", unit: "G", totalQuantity: 500, recipeCount: 2, sourceMeals: [], pantry: { availableQuantity: 200, urgency: "LOW" }, costCents: null },
    ];
    expect(buildSummary(2, 1, [], [], urgent).some((l) => l.includes("Lebensmittelverschwendung"))).toBe(true);
    expect(buildSummary(2, 1, [], [], calm).some((l) => l.includes("Lebensmittelverschwendung"))).toBe(false);
  });

  it("erwähnt eigenständige Rezepte, wenn welche übrig bleiben", () => {
    const solo: SoloRecipe[] = [{ recipeId: "r9", recipeName: "Solo", meals: [{ mealId: "m9", date: new Date(), slot: "DINNER" }] }];
    const lines = buildSummary(3, 2, [], solo, []);
    expect(lines.some((l) => l.includes("1 Rezept(e) bleiben eigenständig"))).toBe(true);
  });
});
