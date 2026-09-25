import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiUserId = vi.fn();
const profileFindUnique = vi.fn();
const getWeeklyShoppingForProfile = vi.fn();

vi.mock("@/lib/session", () => ({
  getApiUserId: (...args: unknown[]) => getApiUserId(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: { profile: { findUnique: (...args: unknown[]) => profileFindUnique(...args) } },
}));

vi.mock("@/lib/shopping/weeklyShoppingService", () => ({
  getWeeklyShoppingForProfile: (...args: unknown[]) => getWeeklyShoppingForProfile(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  getApiUserId.mockResolvedValue("user-1");
  profileFindUnique.mockResolvedValue({ id: "profile-1" });
  getWeeklyShoppingForProfile.mockResolvedValue({ plannedDays: 0, items: [], unresolvedIngredients: [] });
});

describe("GET /api/shopping/week", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiUserId.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(401);
    expect(getWeeklyShoppingForProfile).not.toHaveBeenCalled();
  });

  it("lehnt ein ungültiges Datum mit 400 ab", async () => {
    for (const bad of ["morgen", "2026-02-30", "21.09.2026"]) {
      const res = await GET(new Request(`http://x?date=${encodeURIComponent(bad)}`));
      expect(res.status).toBe(400);
    }
    expect(getWeeklyShoppingForProfile).not.toHaveBeenCalled();
  });

  it("liefert 404 ohne Profil", async () => {
    profileFindUnique.mockResolvedValueOnce(null);
    const res = await GET(new Request("http://x"));
    expect(res.status).toBe(404);
    expect(getWeeklyShoppingForProfile).not.toHaveBeenCalled();
  });

  it("verwendet ausschließlich das aus der Session abgeleitete Profil, nie einen Client-Parameter", async () => {
    await GET(new Request("http://x?profileId=profile-FOREIGN&householdId=household-FOREIGN"));
    expect(profileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: "user-1" } }));
    expect(getWeeklyShoppingForProfile).toHaveBeenCalledWith("profile-1", undefined);
  });

  it("reicht ein gültiges Datum als Kalendertag weiter und liefert 200 mit dem Ergebnis", async () => {
    getWeeklyShoppingForProfile.mockResolvedValueOnce({ plannedDays: 5, items: [], unresolvedIngredients: [] });
    const res = await GET(new Request("http://x?date=2026-09-23"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.shopping.plannedDays).toBe(5);
    expect(getWeeklyShoppingForProfile).toHaveBeenCalledWith("profile-1", "2026-09-23");
  });
});
