import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentHouseholdContext = vi.fn();
const listMembers = vi.fn();

vi.mock("@/lib/household/context", () => ({
  getCurrentHouseholdContext: (...args: unknown[]) => getCurrentHouseholdContext(...args),
}));

vi.mock("@/lib/household/householdService", () => ({
  listMembers: (...args: unknown[]) => listMembers(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/household/members: Authorization", () => {
  it("lehnt eine nicht angemeldete Anfrage mit 401 ab", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(listMembers).not.toHaveBeenCalled();
  });

  it("liefert Mitglieder ausschließlich für den Session-Haushalt, für OWNER und MEMBER gleichermaßen", async () => {
    getCurrentHouseholdContext.mockResolvedValueOnce({ userId: "u2", householdId: "household-A", role: "MEMBER", memberId: "m2" });
    listMembers.mockResolvedValueOnce([{ id: "m1", role: "OWNER" }, { id: "m2", role: "MEMBER" }]);
    const res = await GET();
    const body = await res.json();
    expect(listMembers).toHaveBeenCalledWith("household-A");
    expect(res.status).toBe(200);
    expect(body.members).toHaveLength(2);
  });
});
