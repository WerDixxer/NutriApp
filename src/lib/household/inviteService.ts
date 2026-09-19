import { prisma } from "../db";
import { generateInviteToken, hashInviteToken } from "./token";
import type { CreateInviteInput } from "../validation/household";

export const INVITE_EXPIRY_DAYS = 7;

function isPending(invite: { acceptedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return invite.acceptedAt === null && invite.expiresAt > now;
}

export type CreateInviteError = "ALREADY_PENDING";

/** Gibt den ROH-Token nur hier, einmalig, zurück - danach existiert er nirgends mehr (nur sein Hash ist gespeichert). */
export async function createInvite(
  householdId: string,
  input: CreateInviteInput,
  now: Date = new Date(),
): Promise<{ ok: true; token: string; inviteId: string; expiresAt: Date } | { ok: false; error: CreateInviteError }> {
  const existingPending = await prisma.householdInvite.findFirst({
    where: { householdId, invitedEmail: input.email, acceptedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (existingPending) return { ok: false, error: "ALREADY_PENDING" };

  const token = generateInviteToken();
  const expiresAt = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const invite = await prisma.householdInvite.create({
    data: { householdId, invitedEmail: input.email, role: input.role, tokenHash: hashInviteToken(token), expiresAt },
  });

  return { ok: true, token, inviteId: invite.id, expiresAt: invite.expiresAt };
}

export function listPendingInvites(householdId: string, now: Date = new Date()) {
  return prisma.householdInvite.findMany({
    where: { householdId, acceptedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: { id: true, invitedEmail: true, role: true, expiresAt: true, createdAt: true },
  });
}

export async function revokeInvite(householdId: string, inviteId: string): Promise<boolean> {
  const result = await prisma.householdInvite.deleteMany({ where: { id: inviteId, householdId, acceptedAt: null } });
  return result.count > 0;
}

export interface InvitePreview {
  householdName: string;
  role: "OWNER" | "MEMBER";
}

/**
 * Öffentlich (kein Login nötig) - gibt deshalb bewusst NUR den Haushaltsnamen
 * und die Rolle zurück, nie die eingeladene E-Mail-Adresse, und unterscheidet
 * "nicht gefunden" / "abgelaufen" / "schon angenommen" nicht im Ergebnis
 * (immer `null`), um Token-/Email-Enumeration keine Angriffsfläche zu geben.
 */
export async function previewInvite(token: string, now: Date = new Date()): Promise<InvitePreview | null> {
  const invite = await prisma.householdInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { acceptedAt: true, expiresAt: true, role: true, household: { select: { name: true } } },
  });
  if (!invite || !isPending(invite, now)) return null;
  return { householdName: invite.household.name, role: invite.role };
}

export type AcceptInviteError = "INVALID_OR_EXPIRED" | "EMAIL_MISMATCH" | "ALREADY_IN_HOUSEHOLD";

/**
 * Bindet den (bereits authentifizierten oder gerade frisch registrierten)
 * User an den eingeladenen Haushalt. Der Email-Abgleich ist bewusst nur eine
 * Best-Effort-Absicherung, kein kryptographischer Beweis: diese Architektur
 * hat keine E-Mail-Verifizierung (kein E-Mail-Versand vorhanden, siehe
 * schema.prisma-Kommentar bei HouseholdInvite). Der eigentliche
 * Sicherheitsanker ist der Besitz des hochentropischen Tokens selbst.
 */
export async function acceptInvite(
  token: string,
  userId: string,
  userEmail: string,
  now: Date = new Date(),
): Promise<{ ok: true; householdId: string; role: "OWNER" | "MEMBER" } | { ok: false; error: AcceptInviteError }> {
  const invite = await prisma.householdInvite.findUnique({ where: { tokenHash: hashInviteToken(token) } });
  if (!invite || !isPending(invite, now)) return { ok: false, error: "INVALID_OR_EXPIRED" };

  if (invite.invitedEmail.toLowerCase() !== userEmail.toLowerCase()) {
    return { ok: false, error: "EMAIL_MISMATCH" };
  }

  const existingMembership = await prisma.householdMember.findUnique({ where: { userId }, select: { id: true } });
  if (existingMembership) return { ok: false, error: "ALREADY_IN_HOUSEHOLD" };

  await prisma.$transaction([
    prisma.householdMember.create({ data: { householdId: invite.householdId, userId, role: invite.role } }),
    prisma.householdInvite.update({ where: { id: invite.id }, data: { acceptedAt: now } }),
  ]);

  return { ok: true, householdId: invite.householdId, role: invite.role };
}
