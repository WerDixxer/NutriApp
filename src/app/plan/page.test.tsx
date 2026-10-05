// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Insight } from "@/lib/insights/types";

/**
 * /plan mit Wochen-Navigation (H-2): welche Woche geladen wird und was der Nutzer sieht. Ersetzt sind
 * nur Session, Wochenplan-Laden und Insights - Wochenauflösung, Ledger und Komponenten laufen echt.
 * Dass eine vergangene Woche nur gelesen und nie erzeugt wird, prüft src/test/planHistoryWeeks.test.ts
 * gegen eine echte Datenbank.
 */
const loadWeek = vi.hoisted(() => vi.fn());
const loadInsights = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session", () => ({ requireProfileId: async () => "profile-1" }));
vi.mock("@/lib/generateMealPlan", () => ({ getOrGenerateWeekPlan: loadWeek }));
vi.mock("@/lib/insights/insightService", () => ({ getInsightsForProfile: loadInsights }));

const { default: WeekPlanPage } = await import("./page");

/** Donnerstag, 01.10.2026, 10:00 Uhr in Berlin: laufende Woche ab Montag, 28.09. */
const NOW = new Date("2026-10-01T10:00:00+02:00");
const INSIGHT_MESSAGE = "Deine Paprika sind nur noch bis morgen haltbar.";

function plannedDay(name: string) {
  return {
    items: [
      {
        id: `item-${name}`,
        slot: "LUNCH",
        time: "13:00",
        portionMultiplier: 1,
        recipeName: name,
        recipeKcal: 500,
        recipeProteinG: 30,
        recipeCarbsG: 50,
        recipeFatG: 15,
        recipe: {
          id: `recipe-${name}`,
          name: `${name} (heute umbenannt)`,
          description: "",
          kcal: 999,
          proteinG: 1,
          carbsG: 1,
          fatG: 1,
          prepTimeMin: 10,
          totalTimeMin: null,
          servings: 1,
          ingredients: "[]",
          instructions: "[]",
          isTrending: false,
          trendSource: null,
          tags: "[]",
        },
      },
    ],
  };
}

const pantryInsight: Insight = {
  id: "pantry:expiring:p1",
  type: "PANTRY_EXPIRING_SOON",
  category: "PANTRY",
  priority: "important",
  message: INSIGHT_MESSAGE,
  context: {},
  source: { entity: "PantryItem", id: "p1" },
  surfaces: ["DASHBOARD", "PLAN"],
  detectedAt: NOW,
} as Insight;

async function renderPlan(week?: string) {
  render(await WeekPlanPage({ searchParams: Promise.resolve(week === undefined ? {} : { week }) }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // Der Wocheneinkauf liest die Bildschirmbreite; jsdom kennt matchMedia nicht.
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  loadWeek.mockReset().mockImplementation(async () => [plannedDay("Linsen-Curry"), null, null, null, null, null, null]);
  loadInsights.mockReset().mockResolvedValue([pantryInsight]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("/plan: laufende Woche (unverändert)", () => {
  it("zeigt die laufende Woche mit Wocheneinkauf und Insights, nur Navigation zurück", async () => {
    await renderPlan();

    expect(loadWeek).toHaveBeenCalledWith("profile-1", "2026-09-28", "2026-10-01");
    expect(screen.getByText("Diese Woche")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Wocheneinkauf/ })).toBeTruthy();
    expect(screen.getByText(INSIGHT_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/Rückblick/)).toBeNull();

    const nav = within(screen.getByRole("navigation", { name: "Wochen" }));
    expect(nav.getByRole("link", { name: "← Vorherige Woche" }).getAttribute("href")).toBe("/plan?week=2026-09-21");
    expect(nav.queryByRole("link", { name: "Zur aktuellen Woche" })).toBeNull();
    expect(nav.getAllByRole("link")).toHaveLength(1);
  });

  it("ein Tag der Zukunft im Parameter zeigt ebenfalls die laufende Woche", async () => {
    await renderPlan("2026-10-08");

    expect(loadWeek).toHaveBeenCalledWith("profile-1", "2026-09-28", "2026-10-01");
    expect(screen.getByText("Diese Woche")).toBeTruthy();
  });
});

describe("/plan?week=: vergangene Woche (H-2)", () => {
  it("lädt die Woche des angegebenen Tages, gekennzeichnet als Rückblick, ohne Wocheneinkauf und Insights", async () => {
    await renderPlan("2026-09-16");

    expect(loadWeek).toHaveBeenCalledWith("profile-1", "2026-09-14", "2026-10-01");
    expect(loadInsights).not.toHaveBeenCalled();
    expect(screen.getByText("Vergangene Woche")).toBeTruthy();
    expect(screen.getByText(/Rückblick: So war diese Woche geplant/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Wocheneinkauf/ })).toBeNull();
    expect(screen.queryByText(INSIGHT_MESSAGE)).toBeNull();
  });

  it("zeigt Name und Kalorien wie geplant (Snapshot), fehlende Tage als 'kein Plan gespeichert'", async () => {
    await renderPlan("2026-09-16");

    // Tageszeile und Mahlzeit nennen den geplanten Namen; Live-Name und Live-Kalorien (999) erscheinen nicht.
    expect(screen.getAllByText("Linsen-Curry").length).toBeGreaterThan(0);
    expect(screen.queryByText(/heute umbenannt/)).toBeNull();
    expect(screen.queryByText(/999/)).toBeNull();
    expect(screen.getAllByText(/500 kcal/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Für diesen Tag ist kein Plan gespeichert.")).toHaveLength(6);
    expect(screen.queryByText("Für diesen Tag ist noch kein Plan vorhanden.")).toBeNull();
  });

  it("navigiert weiter zurück und zur aktuellen Woche, nie in die Zukunft - auch über den Monatswechsel", async () => {
    await renderPlan("2026-09-02");

    const nav = within(screen.getByRole("navigation", { name: "Wochen" }));
    expect(nav.getByRole("link", { name: "← Vorherige Woche" }).getAttribute("href")).toBe("/plan?week=2026-08-24");
    expect(nav.getByRole("link", { name: "Zur aktuellen Woche" }).getAttribute("href")).toBe("/plan");
    expect(nav.getAllByRole("link")).toHaveLength(2);
    expect(screen.queryByText(/Nächste Woche/)).toBeNull();
  });

  it("über den Jahreswechsel zurück: die Woche ab 29.12.2025 führt zur Woche ab 22.12.2025", async () => {
    await renderPlan("2026-01-01");

    expect(loadWeek).toHaveBeenCalledWith("profile-1", "2025-12-29", "2026-10-01");
    const nav = within(screen.getByRole("navigation", { name: "Wochen" }));
    expect(nav.getByRole("link", { name: "← Vorherige Woche" }).getAttribute("href")).toBe("/plan?week=2025-12-22");
  });
});
