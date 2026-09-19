import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const getHousehold = vi.fn();
const updateHousehold = vi.fn();
const createSoloHousehold = vi.fn();
const getApiUserId = vi.fn();
const householdMemberFindUnique = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/householdService", () => ({
  getHousehold: (...args: unknown[]) => getHousehold(...args),
  updateHousehold: (...args: unknown[]) => updateHousehold(...args),
  createSoloHousehold: (...args: unknown[]) => createSoloHousehold(...args),
}));

vi.mock("@/lib/session", () => ({
  getApiUserId: (...args: unknown[]) => getApiUserId(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: { householdMember: { findUnique: (...args: unknown[]) => householdMemberFindUnique(...args) } },
}));

const { GET, PATCH, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/household: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getHousehold).not.toHaveBeenCalled();
  });

  it("liefert den Haushalt ausschließlich für die aus der Session abgeleitete householdId", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    getHousehold.mockResolvedValueOnce({ id: "household-A", name: "Test" });
    const res = await GET();
    const body = await res.json();
    expect(getHousehold).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body.role).toBe("OWNER");
  });

  it("liefert 404, wenn der Haushalt (inzwischen) nicht mehr existiert", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    getHousehold.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/household: Rollenprüfung serverseitig", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "X", currency: "EUR" }) }));
    expect(res.status).toBe(401);
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("lehnt ein MEMBER mit 403 ab, ändert nichts", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "X", currency: "EUR" }) }));
    expect(res.status).toBe(403);
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("lehnt eine ungültige Eingabe mit 400 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    const res = await PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "", currency: "EUR" }) }));
    expect(res.status).toBe(400);
    expect(updateHousehold).not.toHaveBeenCalled();
  });

  it("erlaubt den OWNER, aktualisiert nur die eigene householdId, nie eine im Body übergebene", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    updateHousehold.mockResolvedValueOnce({ id: "household-A", name: "Neu", currency: "EUR" });
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ name: "Neu", currency: "EUR", householdId: "household-FOREIGN" }) }),
    );
    expect(res.status).toBe(200);
    expect(updateHousehold).toHaveBeenCalledWith("household-A", expect.objectContaining({ name: "Neu" }));
  });
});

describe("POST /api/household: neuen Haushalt für haushaltslosen Nutzer anlegen", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getApiUserId.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "X" }) }));
    expect(res.status).toBe(401);
    expect(createSoloHousehold).not.toHaveBeenCalled();
  });

  it("lehnt mit 409 ab, wenn der Nutzer bereits einem Haushalt angehört", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce({ id: "member-A" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "X" }) }));
    expect(res.status).toBe(409);
    expect(createSoloHousehold).not.toHaveBeenCalled();
  });

  it("legt für einen haushaltslosen Nutzer einen neuen Haushalt an", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce(null);
    createSoloHousehold.mockResolvedValueOnce({ id: "household-new", name: "Meine WG" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "Meine WG" }) }));
    expect(res.status).toBe(200);
    expect(createSoloHousehold).toHaveBeenCalledWith("user-A", "Meine WG");
  });
});
