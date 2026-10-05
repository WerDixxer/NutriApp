import { describe, expect, it, vi } from "vitest";
import { canSaveProfile, loadProfileForForm, type ProfileLoadState } from "./profileLoad";

const storedProfile = {
  age: 34,
  sex: "FEMALE",
  heightCm: 168,
  weightKg: 62,
  activityLevel: "MODERATE",
  goal: "MAINTAIN",
  goalRateKgPerWeek: 0.5,
  sportType: "STRENGTH",
  dietType: "VEGETARIAN",
  subscribedTrendTags: ["high-protein"],
  likedFoods: [{ label: "Skyr" }],
  dislikedFoods: [{ label: "Paprika" }],
  allergies: [{ label: "Erdnüsse" }],
  priorities: [{ label: "schnell" }],
  trainingSessions: [{ weekday: 1, startTime: "18:00", durationMin: 60, sportType: "STRENGTH", intensity: 3 }],
};

function respondWith(body: unknown, status = 200) {
  return () => Promise.resolve(Response.json(body, { status }));
}

describe("loadProfileForForm (R5F-1)", () => {
  it("bestehendes Profil: Zustand existing mit den gespeicherten Werten, Speichern erlaubt", async () => {
    const state = await loadProfileForForm(respondWith({ profile: storedProfile }));

    expect(state.status).toBe("existing");
    expect(state.status === "existing" && state.profile.allergies).toEqual([{ label: "Erdnüsse" }]);
    expect(canSaveProfile(state)).toBe(true);
  });

  it("noch kein Profil (profile: null): Zustand new, erstes Onboarding darf speichern", async () => {
    const state = await loadProfileForForm(respondWith({ profile: null }));

    expect(state).toEqual({ status: "new" });
    expect(canSaveProfile(state)).toBe(true);
  });

  it.each([
    ["500 (z.B. unlesbare gespeicherte Daten)", 500],
    ["401 (Sitzung abgelaufen)", 401],
    ["404", 404],
  ])("HTTP-Fehler %s: Zustand error, Speichern gesperrt - nie als neues Profil gedeutet", async (_label, status) => {
    const state = await loadProfileForForm(respondWith({ error: "Fehler" }, status));

    expect(state).toEqual({ status: "error" });
    expect(canSaveProfile(state)).toBe(false);
  });

  it("Netzwerkfehler: Zustand error, Speichern gesperrt", async () => {
    const state = await loadProfileForForm(() => Promise.reject(new TypeError("Failed to fetch")));

    expect(state).toEqual({ status: "error" });
    expect(canSaveProfile(state)).toBe(false);
  });

  it.each([
    ["kein JSON", () => Promise.resolve(new Response("<html>Gateway Timeout</html>", { status: 200 }))],
    ["leere Antwort ohne profile-Feld", respondWith({})],
    ["Profil ohne Allergien-Feld", respondWith({ profile: { ...storedProfile, allergies: undefined } })],
    ["Profil mit unbekannter Ernährungsform", respondWith({ profile: { ...storedProfile, dietType: "CARNIVORE" } })],
  ])("ungültige Antwort (%s): Zustand error, nie Startwerte", async (_label, fetchProfile) => {
    expect(await loadProfileForForm(fetchProfile)).toEqual({ status: "error" });
  });

  it("während des Ladens ist Speichern gesperrt", () => {
    expect(canSaveProfile({ status: "loading" })).toBe(false);
  });

  it("nach einem Fehler macht ein erfolgreicher erneuter Versuch das Formular wieder speicherbar", async () => {
    const fetchProfile = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(Response.json({ profile: storedProfile }));

    const states: ProfileLoadState[] = [{ status: "loading" }];
    states.push(await loadProfileForForm(fetchProfile));
    states.push({ status: "loading" }); // "Erneut laden"
    states.push(await loadProfileForForm(fetchProfile));

    expect(states.map((state) => state.status)).toEqual(["loading", "error", "loading", "existing"]);
    expect(states.map(canSaveProfile)).toEqual([false, false, false, true]);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });
});
