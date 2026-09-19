import { beforeEach, describe, expect, it, vi } from "vitest";

const getApiUserId = vi.fn();
const householdMemberFindUnique = vi.fn();
const householdMemberFindMany = vi.fn();

vi.mock("../session", () => ({
  getApiUserId: (...args: unknown[]) => getApiUserId(...args),
}));

vi.mock("../db", () => ({
  prisma: {
    householdMember: {
      findUnique: (...args: unknown[]) => householdMemberFindUnique(...args),
      findMany: (...args: unknown[]) => householdMemberFindMany(...args),
    },
  },
}));

const { getCurrentHouseholdContext, getCurrentHouseholdContextWithMembers } = await import("./context");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentHouseholdContext: Authentifizierung", () => {
  it("gibt null zurück, wenn nicht angemeldet, ohne die DB abzufragen", async () => {
    getApiUserId.mockResolvedValueOnce(null);
    const ctx = await getCurrentHouseholdContext();
    expect(ctx).toBeNull();
    expect(householdMemberFindUnique).not.toHaveBeenCalled();
  });

  it("gibt null zurück, wenn angemeldet, aber keinem Haushalt zugeordnet", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce(null);
    const ctx = await getCurrentHouseholdContext();
    expect(ctx).toBeNull();
  });

  it("lädt userId/householdId/role/memberId in genau einer Query", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce({ id: "member-A", householdId: "household-1", role: "OWNER" });
    const ctx = await getCurrentHouseholdContext();
    expect(householdMemberFindUnique).toHaveBeenCalledTimes(1);
    expect(householdMemberFindUnique).toHaveBeenCalledWith({ where: { userId: "user-A" }, select: { id: true, householdId: true, role: true } });
    expect(ctx).toEqual({ userId: "user-A", householdId: "household-1", role: "OWNER", memberId: "member-A" });
  });
});

describe("getCurrentHouseholdContext: geteilter Haushalt zweier Nutzer", () => {
  it("zwei verschiedene User derselben householdId lösen denselben Haushalt auf, mit jeweils eigener memberId", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce({ id: "member-A", householdId: "household-1", role: "OWNER" });
    const ctxA = await getCurrentHouseholdContext();

    getApiUserId.mockResolvedValueOnce("user-B");
    householdMemberFindUnique.mockResolvedValueOnce({ id: "member-B", householdId: "household-1", role: "MEMBER" });
    const ctxB = await getCurrentHouseholdContext();

    expect(ctxA?.householdId).toBe("household-1");
    expect(ctxB?.householdId).toBe("household-1");
    expect(ctxA?.memberId).not.toBe(ctxB?.memberId);
    expect(ctxA?.role).toBe("OWNER");
    expect(ctxB?.role).toBe("MEMBER");
  });
});

describe("getCurrentHouseholdContextWithMembers", () => {
  it("gibt null zurück ohne Mitglieder-Query, wenn kein Kontext existiert", async () => {
    getApiUserId.mockResolvedValueOnce(null);
    const ctx = await getCurrentHouseholdContextWithMembers();
    expect(ctx).toBeNull();
    expect(householdMemberFindMany).not.toHaveBeenCalled();
  });

  it("lädt die Mitgliederliste in genau einer zusätzlichen Query, nicht pro Mitglied", async () => {
    getApiUserId.mockResolvedValueOnce("user-A");
    householdMemberFindUnique.mockResolvedValueOnce({ id: "member-A", householdId: "household-1", role: "OWNER" });
    householdMemberFindMany.mockResolvedValueOnce([
      { id: "member-A", role: "OWNER", joinedAt: new Date(), user: { id: "user-A", name: "Vincenzo", email: "v@example.com" } },
      { id: "member-B", role: "MEMBER", joinedAt: new Date(), user: { id: "user-B", name: "Partner", email: "p@example.com" } },
    ]);
    const ctx = await getCurrentHouseholdContextWithMembers();
    expect(householdMemberFindMany).toHaveBeenCalledTimes(1);
    expect(householdMemberFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-1" },
      orderBy: { joinedAt: "asc" },
      select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } },
    });
    expect(ctx?.members).toHaveLength(2);
  });
});
