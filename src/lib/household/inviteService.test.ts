import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "./token";

const householdInviteFindFirst = vi.fn();
const householdInviteCreate = vi.fn();
const householdInviteFindMany = vi.fn();
const householdInviteDeleteMany = vi.fn();
const householdInviteFindUnique = vi.fn();
const householdInviteUpdate = vi.fn();
const householdMemberFindUnique = vi.fn();
const householdMemberCreate = vi.fn();
const transaction = vi.fn();

vi.mock("../db", () => ({
  prisma: {
    householdInvite: {
      findFirst: (...args: unknown[]) => householdInviteFindFirst(...args),
      create: (...args: unknown[]) => householdInviteCreate(...args),
      findMany: (...args: unknown[]) => householdInviteFindMany(...args),
      deleteMany: (...args: unknown[]) => householdInviteDeleteMany(...args),
      findUnique: (...args: unknown[]) => householdInviteFindUnique(...args),
      update: (...args: unknown[]) => householdInviteUpdate(...args),
    },
    householdMember: {
      findUnique: (...args: unknown[]) => householdMemberFindUnique(...args),
      create: (...args: unknown[]) => householdMemberCreate(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

const { createInvite, listPendingInvites, revokeInvite, previewInvite, acceptInvite, INVITE_EXPIRY_DAYS } =
  await import("./inviteService");

const now = new Date("2026-09-24T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
});

describe("createInvite", () => {
  it("erzeugt einen Token, speichert aber nur dessen Hash (nie den Rohwert)", async () => {
    householdInviteFindFirst.mockResolvedValueOnce(null);
    householdInviteCreate.mockResolvedValueOnce({ id: "invite-1", expiresAt: new Date(now.getTime() + 1000) });

    const result = await createInvite("household-A", { email: "partner@example.com", role: "MEMBER" }, now);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");

    const createCall = householdInviteCreate.mock.calls[0][0];
    expect(createCall.data.tokenHash).toBe(hashInviteToken(result.token));
    expect(createCall.data.tokenHash).not.toBe(result.token);
    expect(createCall.data.invitedEmail).toBe("partner@example.com");
    expect(createCall.data.role).toBe("MEMBER");
  });

  it("setzt die Ablaufzeit auf INVITE_EXPIRY_DAYS Tage in der Zukunft", async () => {
    householdInviteFindFirst.mockResolvedValueOnce(null);
    householdInviteCreate.mockImplementationOnce(({ data }: { data: { expiresAt: Date } }) =>
      Promise.resolve({ id: "invite-1", expiresAt: data.expiresAt }),
    );
    await createInvite("household-A", { email: "partner@example.com", role: "MEMBER" }, now);
    const createCall = householdInviteCreate.mock.calls[0][0];
    const days = (createCall.data.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(INVITE_EXPIRY_DAYS, 5);
  });

  it("lehnt eine zweite Einladung ab, solange eine offene für dieselbe E-Mail existiert", async () => {
    householdInviteFindFirst.mockResolvedValueOnce({ id: "existing" });
    const result = await createInvite("household-A", { email: "partner@example.com", role: "MEMBER" }, now);
    expect(result).toEqual({ ok: false, error: "ALREADY_PENDING" });
    expect(householdInviteCreate).not.toHaveBeenCalled();
  });
});

describe("listPendingInvites / revokeInvite: Household-Isolation", () => {
  it("listPendingInvites fragt nur offene, nicht abgelaufene Einladungen des Haushalts ab", async () => {
    householdInviteFindMany.mockResolvedValueOnce([]);
    await listPendingInvites("household-A", now);
    expect(householdInviteFindMany).toHaveBeenCalledWith({
      where: { householdId: "household-A", acceptedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      select: { id: true, invitedEmail: true, role: true, expiresAt: true, createdAt: true },
    });
  });

  it("revokeInvite löscht nur innerhalb des eigenen Haushalts und nur unangenommene Einladungen", async () => {
    householdInviteDeleteMany.mockResolvedValueOnce({ count: 1 });
    const result = await revokeInvite("household-A", "invite-1");
    expect(result).toBe(true);
    expect(householdInviteDeleteMany).toHaveBeenCalledWith({ where: { id: "invite-1", householdId: "household-A", acceptedAt: null } });
  });

  it("revokeInvite liefert false für eine fremde/nicht existente Einladung", async () => {
    householdInviteDeleteMany.mockResolvedValueOnce({ count: 0 });
    const result = await revokeInvite("household-B", "invite-of-A");
    expect(result).toBe(false);
  });
});

describe("previewInvite: keine Enumeration", () => {
  it("gibt bei nicht existentem Token null zurück", async () => {
    householdInviteFindUnique.mockResolvedValueOnce(null);
    expect(await previewInvite("unknown-token", now)).toBeNull();
  });

  it("gibt bei abgelaufenem Token null zurück (nicht unterscheidbar von 'nicht gefunden')", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      expiresAt: new Date(now.getTime() - 1000),
      role: "MEMBER",
      household: { name: "Vincenzos Haushalt" },
    });
    expect(await previewInvite("expired-token", now)).toBeNull();
  });

  it("gibt bei bereits angenommenem Token null zurück", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      acceptedAt: new Date(now.getTime() - 1000),
      expiresAt: new Date(now.getTime() + 1000),
      role: "MEMBER",
      household: { name: "Vincenzos Haushalt" },
    });
    expect(await previewInvite("accepted-token", now)).toBeNull();
  });

  it("gibt bei gültigem Token nur Haushaltsname und Rolle zurück, nie die eingeladene E-Mail", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      acceptedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
      role: "MEMBER",
      household: { name: "Vincenzos Haushalt" },
    });
    const preview = await previewInvite("valid-token", now);
    expect(preview).toEqual({ householdName: "Vincenzos Haushalt", role: "MEMBER" });
    expect(preview).not.toHaveProperty("invitedEmail");
  });

  it("hasht den übergebenen Token für den Lookup, sucht nie im Klartext", async () => {
    householdInviteFindUnique.mockResolvedValueOnce(null);
    await previewInvite("some-raw-token", now);
    expect(householdInviteFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashInviteToken("some-raw-token") },
      select: expect.any(Object),
    });
  });
});

describe("acceptInvite: Sicherheit", () => {
  it("lehnt einen ungültigen/unbekannten Token ab", async () => {
    householdInviteFindUnique.mockResolvedValueOnce(null);
    const result = await acceptInvite("bad-token", "user-A", "a@example.com", now);
    expect(result).toEqual({ ok: false, error: "INVALID_OR_EXPIRED" });
  });

  it("lehnt einen abgelaufenen Token ab", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      householdId: "household-A",
      invitedEmail: "a@example.com",
      role: "MEMBER",
      acceptedAt: null,
      expiresAt: new Date(now.getTime() - 1000),
    });
    const result = await acceptInvite("expired-token", "user-A", "a@example.com", now);
    expect(result).toEqual({ ok: false, error: "INVALID_OR_EXPIRED" });
  });

  it("lehnt ab, wenn die E-Mail des Nutzers nicht zur eingeladenen E-Mail passt", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      householdId: "household-A",
      invitedEmail: "a@example.com",
      role: "MEMBER",
      acceptedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
    });
    const result = await acceptInvite("token", "user-B", "voellig-andere@example.com", now);
    expect(result).toEqual({ ok: false, error: "EMAIL_MISMATCH" });
    expect(householdMemberCreate).not.toHaveBeenCalled();
  });

  it("vergleicht die E-Mail case-insensitiv", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      householdId: "household-A",
      invitedEmail: "Partner@Example.com",
      role: "MEMBER",
      acceptedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
    });
    householdMemberFindUnique.mockResolvedValueOnce(null);
    const result = await acceptInvite("token", "user-B", "partner@example.com", now);
    expect(result.ok).toBe(true);
  });

  it("lehnt ab, wenn der Nutzer bereits einem (auch anderen) Haushalt angehört", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      householdId: "household-A",
      invitedEmail: "a@example.com",
      role: "MEMBER",
      acceptedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
    });
    householdMemberFindUnique.mockResolvedValueOnce({ id: "existing-membership" });
    const result = await acceptInvite("token", "user-A", "a@example.com", now);
    expect(result).toEqual({ ok: false, error: "ALREADY_IN_HOUSEHOLD" });
    expect(householdMemberCreate).not.toHaveBeenCalled();
  });

  it("legt bei Erfolg die HouseholdMember-Zeile an und markiert die Einladung als angenommen, atomar", async () => {
    householdInviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      householdId: "household-A",
      invitedEmail: "a@example.com",
      role: "MEMBER",
      acceptedAt: null,
      expiresAt: new Date(now.getTime() + 1000),
    });
    householdMemberFindUnique.mockResolvedValueOnce(null);

    const result = await acceptInvite("token", "user-A", "a@example.com", now);
    expect(result).toEqual({ ok: true, householdId: "household-A", role: "MEMBER" });
    expect(householdMemberCreate).toHaveBeenCalledWith({ data: { householdId: "household-A", userId: "user-A", role: "MEMBER" } });
    expect(householdInviteUpdate).toHaveBeenCalledWith({ where: { id: "invite-1" }, data: { acceptedAt: now } });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
