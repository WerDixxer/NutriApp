import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const transferOwnership = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/householdService", () => ({
  transferOwnership: (...args: unknown[]) => transferOwnership(...args),
}));

const { POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/household/transfer-ownership: nur OWNER", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ targetMemberId: "m2" }) }));
    expect(res.status).toBe(401);
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("lehnt ein MEMBER mit 403 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ targetMemberId: "m1" }) }));
    expect(res.status).toBe(403);
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("lehnt eine leere targetMemberId mit 400 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ targetMemberId: "" }) }));
    expect(res.status).toBe(400);
    expect(transferOwnership).not.toHaveBeenCalled();
  });

  it("liefert 404 für ein Zielmitglied außerhalb des eigenen Haushalts", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    transferOwnership.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ targetMemberId: "member-of-B" }) }));
    expect(res.status).toBe(404);
    expect(transferOwnership).toHaveBeenCalledWith("household-A", "m1", "member-of-B");
  });

  it("überträgt erfolgreich an ein Mitglied des eigenen Haushalts", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    transferOwnership.mockResolvedValueOnce({ ok: true });
    const res = await POST(new Request("http://x", { method: "POST", body: JSON.stringify({ targetMemberId: "m2" }) }));
    expect(res.status).toBe(200);
  });
});
