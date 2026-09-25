import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { UpdateHouseholdInput } from "../validation/household";
import type { HouseholdMemberView } from "./context";

/**
 * Wie pantryService.ts/budgetService.ts: JEDE Funktion nimmt `householdId`
 * entgegen und filtert danach (nie nach einer fremden id allein), damit eine
 * erratene/fremde ID konsequent zu "nicht gefunden" führt statt zu Daten
 * eines anderen Haushalts. Rollen-Prüfung (OWNER-only) passiert in den
 * API-Routen anhand des HouseholdContext, nicht hier - dieselbe Schichtung
 * wie bei allen bisherigen Household-scoped Services.
 */

export function getHousehold(householdId: string) {
  return prisma.household.findUnique({ where: { id: householdId } });
}

/**
 * Erstellt einen neuen Haushalt mit dem übergebenen User als alleinigem
 * OWNER. Von registerAction() (neue Registrierung) UND von der
 * /api/household-POST-Route (bestehender, aktuell haushaltsloser User, z.B.
 * nach dem Verlassen seines vorherigen Haushalts, siehe leaveHousehold())
 * genutzt, damit diese Logik nur einmal existiert. Ob der User schon ein
 * Haushaltsmitglied ist, prüft der Aufrufer; ist er es doch (z.B. durch einen
 * parallelen Request), wirft der Unique-Index auf HouseholdMember.userId P2002.
 * Haushalt und Mitgliedschaft entstehen in EINEM Schreibvorgang, es bleibt also
 * nie ein Haushalt ohne Mitglied zurück. `db`: für Aufrufer, die das in ihre
 * eigene Transaktion einbetten (registerAction()).
 */
export function createSoloHousehold(userId: string, name: string, db: Prisma.TransactionClient = prisma) {
  return db.household.create({ data: { name, members: { create: { userId, role: "OWNER" } } } });
}

export function updateHousehold(householdId: string, input: UpdateHouseholdInput) {
  return prisma.household.update({ where: { id: householdId }, data: { name: input.name, currency: input.currency } });
}

export function listMembers(householdId: string): Promise<HouseholdMemberView[]> {
  return prisma.householdMember.findMany({
    where: { householdId },
    orderBy: { joinedAt: "asc" },
    select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } },
  });
}

export type RemoveMemberError = "NOT_FOUND" | "CANNOT_REMOVE_OWNER";

export async function removeMember(
  householdId: string,
  memberId: string,
): Promise<{ ok: true } | { ok: false; error: RemoveMemberError }> {
  const target = await prisma.householdMember.findFirst({ where: { id: memberId, householdId } });
  if (!target) return { ok: false, error: "NOT_FOUND" };
  // Ein OWNER kann nicht per "Mitglied entfernen" verschwinden (das würde
  // einen Haushalt ohne Eigentümer erzeugen) - dafür gibt es transferOwnership()
  // + leaveHousehold(), siehe household/leave.
  if (target.role === "OWNER") return { ok: false, error: "CANNOT_REMOVE_OWNER" };

  await prisma.householdMember.delete({ where: { id: memberId } });
  return { ok: true };
}

export type TransferOwnershipError = "NOT_FOUND" | "SELF";

export async function transferOwnership(
  householdId: string,
  actingMemberId: string,
  targetMemberId: string,
): Promise<{ ok: true } | { ok: false; error: TransferOwnershipError }> {
  if (actingMemberId === targetMemberId) return { ok: false, error: "SELF" };

  const target = await prisma.householdMember.findFirst({ where: { id: targetMemberId, householdId } });
  if (!target) return { ok: false, error: "NOT_FOUND" };

  await prisma.$transaction([
    prisma.householdMember.update({ where: { id: actingMemberId }, data: { role: "MEMBER" } }),
    prisma.householdMember.update({ where: { id: targetMemberId }, data: { role: "OWNER" } }),
  ]);
  return { ok: true };
}

export type LeaveHouseholdResult =
  | { type: "LEFT" }
  | { type: "DISSOLVED" }
  | { type: "OWNER_MUST_TRANSFER_FIRST" };

/**
 * MEMBER: verlässt den Haushalt einfach (eigene HouseholdMember-Zeile
 * gelöscht, User/Profil/persönliche Daten bleiben unangetastet). OWNER als
 * einziges Mitglied: löst den Haushalt auf (Household-Zeile löschen -
 * kaskadiert per schema.prisma onDelete:Cascade auf Pantry/Budget/Expenses/
 * Invites, absichtlich, da es dann keine anderen Mitglieder gibt, die diese
 * Daten noch bräuchten). OWNER mit weiteren Mitgliedern: abgelehnt, verweist
 * auf transferOwnership() zuerst - kein verwaister Haushalt möglich.
 */
export async function leaveHousehold(
  householdId: string,
  memberId: string,
  role: "OWNER" | "MEMBER",
): Promise<LeaveHouseholdResult> {
  if (role === "MEMBER") {
    await prisma.householdMember.delete({ where: { id: memberId } });
    return { type: "LEFT" };
  }

  const memberCount = await prisma.householdMember.count({ where: { householdId } });
  if (memberCount > 1) return { type: "OWNER_MUST_TRANSFER_FIRST" };

  await prisma.household.delete({ where: { id: householdId } });
  return { type: "DISSOLVED" };
}
