import { beforeEach, describe, expect, it, vi } from "vitest";

const householdFindUnique = vi.fn();
const householdUpdate = vi.fn();
const householdCreate = vi.fn();
const householdDelete = vi.fn();
const householdMemberFindMany = vi.fn();
const householdMemberFindFirst = vi.fn();
const householdMemberDelete = vi.fn();
const householdMemberCreate = vi.fn();
const householdMemberUpdate = vi.fn();
const householdMemberCount = vi.fn();
const transaction = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    household: {
      findUnique: (...args: unknown[]) => householdFindUnique(...args),
      update: (...args: unknown[]) => householdUpdate(...args),
      create: (...args: unknown[]) => householdCreate(...args),
      delete: (...args: unknown[]) => householdDelete(...args),
    },
    householdMember: {
      findMany: (...args: unknown[]) => householdMemberFindMany(...args),
      findFirst: (...args: unknown[]) => householdMemberFindFirst(...args),
      delete: (...args: unknown[]) => householdMemberDelete(...args),
      create: (...args: unknown[]) => householdMemberCreate(...args),
      update: (...args: unknown[]) => householdMemberUpdate(...args),
      count: (...args: unknown[]) => householdMemberCount(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

const {
  getHousehold,
  updateHousehold,
  listMembers,
  removeMember,
  transferOwnership,
  leaveHousehold,
  createSoloHousehold,
} = await import("./householdService");

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

describe("getHousehold / updateHousehold: Household-Isolation", () => {
  it("getHousehold fragt exakt nach der übergebenen id", async () => {
    householdFindUnique.mockResolvedValueOnce({ id: "household-A" });
    await getHousehold("household-A");
    expect(householdFindUnique).toHaveBeenCalledWith({ where: { id: "household-A" } });
  });

  it("updateHousehold schreibt nur name/currency, nichts anderes", async () => {
    householdUpdate.mockResolvedValueOnce({ id: "household-A" });
    await updateHousehold("household-A", { name: "Neuer Name", currency: "EUR" });
    expect(householdUpdate).toHaveBeenCalledWith({ where: { id: "household-A" }, data: { name: "Neuer Name", currency: "EUR" } });
  });
});

describe("listMembers: keine persönlichen Profildaten im Ergebnis", () => {
  it("selektiert ausschließlich id/role/joinedAt/user{id,name,email}, nie Nutrition-/Profil-Felder", async () => {
    householdMemberFindMany.mockResolvedValueOnce([]);
    await listMembers("household-A");
    expect(householdMemberFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-A" },
      orderBy: { joinedAt: "asc" },
      select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } },
    });
  });

  it("lädt alle Mitglieder in genau einer Query (keine N+1)", async () => {
    householdMemberFindMany.mockResolvedValueOnce([{ id: "1" }, { id: "2" }, { id: "3" }]);
    await listMembers("household-A");
    expect(householdMemberFindMany).toHaveBeenCalledTimes(1);
  });
});

describe("removeMember: Authorization und Invarianten", () => {
  it("liefert NOT_FOUND für ein Mitglied eines anderen Haushalts", async () => {
    householdMemberFindFirst.mockResolvedValueOnce(null);
    const result = await removeMember("household-B", "member-of-A");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(householdMemberDelete).not.toHaveBeenCalled();
    expect(householdMemberFindFirst).toHaveBeenCalledWith({ where: { id: "member-of-A", householdId: "household-B" } });
  });

  it("verweigert das Entfernen eines OWNER (verwaister Haushalt wäre sonst möglich)", async () => {
    householdMemberFindFirst.mockResolvedValueOnce({ id: "member-1", role: "OWNER" });
    const result = await removeMember("household-A", "member-1");
    expect(result).toEqual({ ok: false, error: "CANNOT_REMOVE_OWNER" });
    expect(householdMemberDelete).not.toHaveBeenCalled();
  });

  it("entfernt ein MEMBER erfolgreich", async () => {
    householdMemberFindFirst.mockResolvedValueOnce({ id: "member-2", role: "MEMBER" });
    householdMemberDelete.mockResolvedValueOnce({ id: "member-2" });
    const result = await removeMember("household-A", "member-2");
    expect(result).toEqual({ ok: true });
    expect(householdMemberDelete).toHaveBeenCalledWith({ where: { id: "member-2" } });
  });
});

describe("transferOwnership", () => {
  it("lehnt eine Übertragung an sich selbst ab", async () => {
    const result = await transferOwnership("household-A", "member-1", "member-1");
    expect(result).toEqual({ ok: false, error: "SELF" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("liefert NOT_FOUND für ein Zielmitglied außerhalb des Haushalts", async () => {
    householdMemberFindFirst.mockResolvedValueOnce(null);
    const result = await transferOwnership("household-A", "member-1", "member-of-B");
    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("überträgt atomar: alter Owner wird MEMBER, neuer Owner wird OWNER", async () => {
    householdMemberFindFirst.mockResolvedValueOnce({ id: "member-2" });
    const result = await transferOwnership("household-A", "member-1", "member-2");
    expect(result).toEqual({ ok: true });
    expect(householdMemberUpdate).toHaveBeenCalledWith({ where: { id: "member-1" }, data: { role: "MEMBER" } });
    expect(householdMemberUpdate).toHaveBeenCalledWith({ where: { id: "member-2" }, data: { role: "OWNER" } });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("leaveHousehold: sichere Zustände, kein verwaister Haushalt", () => {
  it("ein MEMBER verlässt einfach: löscht nur die eigene HouseholdMember-Zeile", async () => {
    householdMemberDelete.mockResolvedValueOnce({ id: "member-2" });
    const result = await leaveHousehold("household-A", "member-2", "MEMBER");
    expect(result).toEqual({ type: "LEFT" });
    expect(householdMemberDelete).toHaveBeenCalledWith({ where: { id: "member-2" } });
    expect(householdDelete).not.toHaveBeenCalled();
  });

  it("ein OWNER als einziges Mitglied löst den Haushalt auf", async () => {
    householdMemberCount.mockResolvedValueOnce(1);
    householdDelete.mockResolvedValueOnce({ id: "household-A" });
    const result = await leaveHousehold("household-A", "member-1", "OWNER");
    expect(result).toEqual({ type: "DISSOLVED" });
    expect(householdDelete).toHaveBeenCalledWith({ where: { id: "household-A" } });
  });

  it("ein OWNER mit weiteren Mitgliedern wird abgewiesen, kein verwaister Haushalt", async () => {
    householdMemberCount.mockResolvedValueOnce(2);
    const result = await leaveHousehold("household-A", "member-1", "OWNER");
    expect(result).toEqual({ type: "OWNER_MUST_TRANSFER_FIRST" });
    expect(householdDelete).not.toHaveBeenCalled();
    expect(householdMemberDelete).not.toHaveBeenCalled();
  });
});

describe("createSoloHousehold", () => {
  it("legt einen neuen Haushalt mit dem User als alleinigem OWNER an, in einem einzigen Schreibvorgang (R4C)", async () => {
    householdCreate.mockResolvedValueOnce({ id: "household-new", name: "Xs Haushalt" });
    await createSoloHousehold("user-X", "Xs Haushalt");
    expect(householdCreate).toHaveBeenCalledWith({ data: { name: "Xs Haushalt", members: { create: { userId: "user-X", role: "OWNER" } } } });
    expect(householdMemberCreate).not.toHaveBeenCalled();
  });
});
