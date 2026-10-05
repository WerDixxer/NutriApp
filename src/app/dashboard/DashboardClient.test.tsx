// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardClient, { type PlanItemView } from "./DashboardClient";

/**
 * Logging auf dem Dashboard (R5F-2), geprüft über das, was der Nutzer sieht: Eine Mahlzeit gilt erst
 * als geloggt, wenn der Server den Eintrag bestätigt hat. `fetch` ist global ersetzt; darunter läuft
 * das echte logRequests.ts.
 */
const porridge: PlanItemView = {
  id: "item-1",
  slot: "BREAKFAST",
  time: "08:00",
  recipe: {
    id: "recipe-1",
    name: "Porridge mit Beeren",
    description: "Haferflocken, Milch und Beeren.",
    imageQuery: "",
    kcal: 420,
    proteinG: 18,
    carbsG: 60,
    fatG: 10,
    prepTimeMin: 10,
    servings: 1,
    ingredients: ["60 g Haferflocken"],
    instructions: ["Kochen."],
    isTrending: false,
    trendSource: null,
  },
};

const NOTHING_LOGGED = "Noch nichts geloggt. Sobald du eine Mahlzeit abhakst, taucht sie hier auf.";
const LOG_FAILED = "Die Mahlzeit konnte nicht geloggt werden. Bitte versuche es erneut.";

function renderDashboard() {
  render(
    <DashboardClient
      date="2026-09-30"
      targets={{ kcal: 2200, proteinG: 120, carbsG: 250, fatG: 70 }}
      initialPlanItems={[porridge]}
      initialEntries={[]}
      insights={[]}
    />,
  );
}

const logButton = () => screen.getByRole("button", { name: "Als gegessen loggen" });

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Dashboard: Mahlzeit loggen (R5F-2)", () => {
  it("zeigt die Mahlzeit erst nach der Bestätigung des Servers als geloggt", async () => {
    let confirm!: (response: Response) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => (confirm = resolve)));
    renderDashboard();

    fireEvent.click(logButton());

    // Während der Anfrage: Aktion gesperrt, noch nichts als geloggt angezeigt.
    expect(logButton()).toHaveProperty("disabled", true);
    expect(screen.getByText(NOTHING_LOGGED)).toBeTruthy();

    await act(async () => confirm(Response.json({ entry: { id: "entry-1" } })));

    expect(screen.queryByText(NOTHING_LOGGED)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Entfernen" })).not.toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith("/api/log", expect.objectContaining({ method: "POST" }));
  });

  it.each([
    ["HTTP-Fehler", () => Promise.resolve(Response.json({ error: "Rezept nicht gefunden." }, { status: 404 }))],
    ["Netzwerkfehler", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["ungültige Antwort", () => Promise.resolve(Response.json({ ok: true }))],
  ])("%s: Fehlermeldung, die Mahlzeit bleibt ungeloggt und kann erneut geloggt werden", async (_label, respond) => {
    fetchMock.mockImplementation(respond);
    renderDashboard();

    await act(async () => fireEvent.click(logButton()));

    expect(screen.getByRole("alert").textContent).toBe(LOG_FAILED);
    expect(screen.getByText(NOTHING_LOGGED)).toBeTruthy();
    expect(logButton()).toHaveProperty("disabled", false);
  });

  it("ein erneuter Versuch nach einem Fehler loggt die Mahlzeit und entfernt die Meldung", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(Response.json({ entry: { id: "entry-1" } }));
    renderDashboard();

    await act(async () => fireEvent.click(logButton()));
    expect(screen.getByRole("alert")).toBeTruthy();

    await act(async () => fireEvent.click(logButton()));

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(NOTHING_LOGGED)).toBeNull();
  });
});
