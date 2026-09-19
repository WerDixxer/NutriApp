import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const revokeInvite = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/inviteService", () => ({
  revokeInvite: (...args: unknown[]) => revokeInvite(...args),
}));

const { DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/household/invites/[id]: nur OWNER", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x"), ctx("invite-1"));
    expect(res.status).toBe(401);
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it("lehnt ein MEMBER mit 403 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await DELETE(new Request("http://x"), ctx("invite-1"));
    expect(res.status).toBe(403);
    expect(revokeInvite).not.toHaveBeenCalled();
  });

  it("liefert 404 für eine fremde/nicht existente Einladung", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-B", role: "OWNER", memberId: "m1" });
    revokeInvite.mockResolvedValueOnce(false);
    const res = await DELETE(new Request("http://x"), ctx("invite-of-A"));
    expect(res.status).toBe(404);
    expect(revokeInvite).toHaveBeenCalledWith("household-B", "invite-of-A");
  });

  it("zieht eine eigene offene Einladung erfolgreich zurück", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    revokeInvite.mockResolvedValueOnce(true);
    const res = await DELETE(new Request("http://x"), ctx("invite-1"));
    expect(res.status).toBe(200);
  });
});
