import { prisma } from "../db";
import { getApiUserId } from "../session";

/**
 * Zentraler, wiederverwendbarer Household-Kontext für API-Routen, die (anders
 * als die bestehenden Pantry-/Budget-Routen) auch die ROLLE des Nutzers
 * brauchen, nicht nur die householdId. Ersetzt `getApiHouseholdId()` NICHT:
 * die bleibt für alle Routen, die nur die householdId brauchen (Pantry,
 * Budget), die schlankere und damit richtige Wahl.
 *
 * Eine einzige Query (`householdMember.findUnique` über den unique `userId`-
 * Index) liefert userId + householdId + role + memberId zusammen, damit keine
 * Route für "wer bin ich in diesem Haushalt" zwei Round-Trips braucht.
 */
export interface HouseholdContext {
  userId: string;
  householdId: string;
  role: "OWNER" | "MEMBER";
  memberId: string;
}

export async function getCurrentHouseholdContext(): Promise<HouseholdContext | null> {
  const userId = await getApiUserId();
  if (!userId) return null;

  const membership = await prisma.householdMember.findUnique({
    where: { userId },
    select: { id: true, householdId: true, role: true },
  });
  if (!membership) return null;

  return { userId, householdId: membership.householdId, role: membership.role, memberId: membership.id };
}

export interface HouseholdMemberView {
  id: string;
  role: "OWNER" | "MEMBER";
  joinedAt: Date;
  user: { id: string; name: string | null; email: string | null };
}

/**
 * Wie getCurrentHouseholdContext(), lädt aber zusätzlich die Mitgliederliste
 * in derselben Anfrage-Bearbeitung dazu (eine zweite, gezielte Query - nicht
 * pro Mitglied, siehe listMembers() in householdService.ts). Nur für Routen/
 * Seiten nutzen, die die Mitgliederliste tatsächlich brauchen (Household-
 * Seite), nicht als Standard-Kontext für jede Route.
 */
export async function getCurrentHouseholdContextWithMembers(): Promise<
  (HouseholdContext & { members: HouseholdMemberView[] }) | null
> {
  const ctx = await getCurrentHouseholdContext();
  if (!ctx) return null;

  const members = await prisma.householdMember.findMany({
    where: { householdId: ctx.householdId },
    orderBy: { joinedAt: "asc" },
    select: { id: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true } } },
  });

  return { ...ctx, members };
}
