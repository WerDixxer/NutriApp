import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const createInvite = vi.fn();
const listPendingInvites = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/inviteService", () => ({
  createInvite: (...args: unknown[]) => createInvite(...args),
  listPendingInvites: (...args: unknown[]) => listPendingInvites(...args),
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/household/invites: nur OWNER", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lehnt ein MEMBER mit 403 ab: Einladungen sind Owner-only sichtbar", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listPendingInvites).not.toHaveBeenCalled();
  });

  it("liefert offene Einladungen für den OWNER", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    listPendingInvites.mockResolvedValueOnce([{ id: "invite-1" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(listPendingInvites).toHaveBeenCalledWith("household-A");
  });
});

describe("POST /api/household/invites: nur OWNER, Validierung", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@example.com" }) }));
    expect(res.status).toBe(401);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("lehnt ein MEMBER mit 403 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@example.com" }) }));
    expect(res.status).toBe(403);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("lehnt eine ungültige E-Mail mit 400 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "nicht-valide" }) }));
    expect(res.status).toBe(400);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("lehnt role:OWNER im Body mit 400 ab (nie Ownership per Invite)", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@example.com", role: "OWNER" }) }));
    expect(res.status).toBe(400);
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("liefert 409, wenn bereits eine offene Einladung existiert", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    createInvite.mockResolvedValueOnce({ ok: false, error: "ALREADY_PENDING" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@example.com" }) }));
    expect(res.status).toBe(409);
  });

  it("erzeugt eine Einladung für den Session-Haushalt, nie eine aus dem Body übergebene", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    createInvite.mockResolvedValueOnce({ ok: true, token: "raw-token", inviteId: "invite-1", expiresAt: new Date() });
    const res = await POST(
      new Request("http://x", { method: "POST", body: JSON.stringify({ email: "a@example.com", householdId: "household-FOREIGN" }) }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(createInvite).toHaveBeenCalledWith("household-A", expect.objectContaining({ email: "a@example.com" }));
    expect(body.token).toBe("raw-token");
    expect(body.inviteUrl).toBe("/invite/raw-token");
  });
});
