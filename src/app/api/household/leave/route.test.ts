import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const leaveHousehold = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/householdService", () => ({
  leaveHousehold: (...args: unknown[]) => leaveHousehold(...args),
}));

const { POST } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/household/leave", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(leaveHousehold).not.toHaveBeenCalled();
  });

  it("verwendet ausschließlich householdId/memberId/role aus dem Session-Kontext", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    leaveHousehold.mockResolvedValueOnce({ type: "LEFT" });
    await POST();
    expect(leaveHousehold).toHaveBeenCalledWith("household-A", "m2", "MEMBER");
  });

  it("ein MEMBER verlässt erfolgreich (dissolved: false)", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    leaveHousehold.mockResolvedValueOnce({ type: "LEFT" });
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.dissolved).toBe(false);
  });

  it("ein OWNER als einziges Mitglied löst auf (dissolved: true)", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    leaveHousehold.mockResolvedValueOnce({ type: "DISSOLVED" });
    const res = await POST();
    const body = await res.json();
    expect(body.dissolved).toBe(true);
  });

  it("ein OWNER mit weiteren Mitgliedern wird mit 409 abgewiesen", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u1", householdId: "household-A", role: "OWNER", memberId: "m1" });
    leaveHousehold.mockResolvedValueOnce({ type: "OWNER_MUST_TRANSFER_FIRST" });
    const res = await POST();
    expect(res.status).toBe(409);
  });
});
