import { prisma } from "../db";

/**
 * Leitet die Haushalts-ID zu einer Profil-ID ab (Profile -> User ->
 * HouseholdMember). Getrennt von context.ts, weil Aufrufer wie die Decision
 * Engine mit einer `profileId` arbeiten, die nicht zwingend aus der aktuellen
 * Request-Session stammt (z.B. später aus einem Scheduler/Cron-Kontext).
 */
export async function getHouseholdIdForProfile(profileId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: profileId },
    select: { user: { select: { householdMembership: { select: { householdId: true } } } } },
  });
  return profile?.user.householdMembership?.householdId ?? null;
}
