// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecipeDetail } from "@/components/RecipeDetailModal";
import TrendsGrid from "./TrendsGrid";

/**
 * Trend-Filter (R5F-3), geprüft über das, was der Nutzer sieht: welche Rezepte der Feed zeigt, ob die
 * Filter bedienbar sind und ob eine Meldung erscheint. Gespeichert wird immer die vollständige Liste -
 * darum nur nach erfolgreichem Laden und erst nach Bestätigung des Servers. `fetch` ist global ersetzt;
 * darunter läuft das echte trendTagRequests.ts.
 */
function trendRecipe(id: string, name: string, tags: string[]): RecipeDetail {
  return {
    id,
    name,
    description: "",
    imageQuery: "",
    kcal: 500,
    proteinG: 30,
    carbsG: 50,
    fatG: 15,
    prepTimeMin: 15,
    servings: 1,
    ingredients: [],
    instructions: [],
    isTrending: true,
    trendSource: null,
    tags,
  };
}

const recipes = [
  trendRecipe("r1", "Vegane Bowl", ["vegan"]),
  trendRecipe("r2", "Keto Wrap", ["keto"]),
  trendRecipe("r3", "Airfryer Tofu", ["vegan", "airfryer"]),
];

const LOAD_FAILED = "Deine Trend-Auswahl konnte nicht geladen werden. Damit sie nicht überschrieben wird, kannst du sie gerade nicht ändern.";
const SAVE_FAILED = "Deine Trend-Auswahl konnte nicht gespeichert werden. Bitte versuche es erneut.";

const filter = (tag: string) => screen.getByRole("button", { name: `#${tag}` });
const shownRecipes = () => ["Vegane Bowl", "Keto Wrap", "Airfryer Tofu"].filter((name) => screen.queryByText(name) !== null);
const saveRequests = () => fetchMock.mock.calls.filter(([url]) => url === "/api/profile/trend-tags");

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

/** GET /api/profile liefert `profileResponse`, POST /api/profile/trend-tags `saveResponse()`. */
function serve(profileResponse: () => Promise<Response>, saveResponse: () => Promise<Response> = () => Promise.resolve(Response.json({ ok: true }))) {
  fetchMock.mockImplementation((url) => (url === "/api/profile" ? profileResponse() : saveResponse()));
}

const storedTags = (tags: string[]) => () => Promise.resolve(Response.json({ profile: { subscribedTrendTags: tags } }));

async function renderLoaded() {
  render(<TrendsGrid recipes={recipes} />);
  await waitFor(() => expect(filter("vegan")).toHaveProperty("disabled", false));
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Trends: gespeicherte Auswahl laden (R5F-3)", () => {
  it("filtert den Feed nach den gespeicherten Tags", async () => {
    serve(storedTags(["vegan"]));

    await renderLoaded();

    expect(shownRecipes()).toEqual(["Vegane Bowl", "Airfryer Tofu"]);
  });

  it("nach einem Ladefehler: Meldung, keine leere Auswahl, Filter gesperrt, nichts wird gespeichert", async () => {
    serve(() => Promise.resolve(Response.json({ error: "Interner Fehler" }, { status: 500 })));
    render(<TrendsGrid recipes={recipes} />);

    expect((await screen.findByRole("alert")).textContent).toBe(LOAD_FAILED);
    expect(filter("keto")).toHaveProperty("disabled", true);

    fireEvent.click(filter("keto"));

    expect(saveRequests()).toHaveLength(0);
    expect(shownRecipes()).toEqual(["Vegane Bowl", "Keto Wrap", "Airfryer Tofu"]);
  });
});

describe("Trends: Auswahl ändern (R5F-3)", () => {
  it("übernimmt die neue Auswahl erst nach Bestätigung; während des Speicherns sind die Filter gesperrt", async () => {
    let confirm!: (response: Response) => void;
    serve(storedTags([]), () => new Promise((resolve) => (confirm = resolve)));
    await renderLoaded();

    fireEvent.click(filter("keto"));

    expect(filter("vegan")).toHaveProperty("disabled", true);
    expect(shownRecipes()).toEqual(["Vegane Bowl", "Keto Wrap", "Airfryer Tofu"]);
    expect(saveRequests()[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ tags: ["keto"] }) });

    await act(async () => confirm(Response.json({ ok: true })));

    expect(shownRecipes()).toEqual(["Keto Wrap"]);
    expect(filter("vegan")).toHaveProperty("disabled", false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["HTTP-Fehler", () => Promise.resolve(Response.json({ error: "Kein Profil vorhanden." }, { status: 404 }))],
    ["Netzwerkfehler", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])("%s beim Speichern: Meldung, die Auswahl bleibt wie gespeichert, Filter wieder bedienbar", async (_label, saveResponse) => {
    serve(storedTags(["vegan"]), saveResponse);
    await renderLoaded();

    await act(async () => fireEvent.click(filter("keto")));

    expect(screen.getByRole("alert").textContent).toBe(SAVE_FAILED);
    expect(shownRecipes()).toEqual(["Vegane Bowl", "Airfryer Tofu"]);
    expect(filter("keto")).toHaveProperty("disabled", false);
  });
});
