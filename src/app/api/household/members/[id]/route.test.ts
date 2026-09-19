import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const removeMember = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/householdService", () => ({
  removeMember: (...args: unknown[]) => removeMember(...args),
}));

const { DELETE } = await import("./route");

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DELETE /api/household/members/[id]: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await DELETE(new Request("http://x"), ctx("member-2"));
    expect(res.status).toBe(401);
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("lehnt ein MEMBER (keine Owner-Rechte) mit 403 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await DELETE(new Request("http://x"), ctx("member-3"));
    expect(res.status).toBe(403);
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("lehnt den Versuch ab, sich selbst über diese Route zu entfernen", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    const res = await DELETE(new Request("http://x"), ctx("m1"));
    expect(res.status).toBe(400);
    expect(removeMember).not.toHaveBeenCalled();
  });

  it("liefert 404 für ein Mitglied eines fremden Haushalts (Service-Isolation greift)", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-B", role: "OWNER", memberId: "m1" });
    removeMember.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    const res = await DELETE(new Request("http://x"), ctx("member-of-A"));
    expect(res.status).toBe(404);
    expect(removeMember).toHaveBeenCalledWith("household-B", "member-of-A");
  });

  it("liefert 409, wenn versucht wird, den OWNER zu entfernen", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    removeMember.mockResolvedValueOnce({ ok: false, error: "CANNOT_REMOVE_OWNER" });
    const res = await DELETE(new Request("http://x"), ctx("some-owner-id"));
    expect(res.status).toBe(409);
  });

  it("entfernt erfolgreich ein MEMBER als OWNER", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    removeMember.mockResolvedValueOnce({ ok: true });
    const res = await DELETE(new Request("http://x"), ctx("member-2"));
    expect(res.status).toBe(200);
  });
});
