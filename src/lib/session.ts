import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./db";

/** Für Server Components/Pages: gibt die eingeloggte User-ID zurück oder leitet zu /login um. */
export async function requireSessionUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** Für API Route Handler: gibt die eingeloggte User-ID zurück oder null (kein Redirect). */
export async function getApiUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * Für Server Components/Pages: lädt das vollständige Profil (inkl. Tags,
 * Trainingseinheiten, User-Stammdaten) des eingeloggten Nutzers. Leitet zu
 * /login um, wenn nicht eingeloggt, zu /onboarding, wenn noch kein Profil
 * existiert.
 */
export async function requireProfile() {
  const userId = await requireSessionUserId();
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      user: true,
      allergies: true,
      likedFoods: true,
      dislikedFoods: true,
      priorities: true,
      trainingSessions: true,
    },
  });
  if (!profile) redirect("/onboarding");
  return profile;
}

/** Für Server Components/Pages, die nur die Profil-ID brauchen. */
export async function requireProfileId(): Promise<string> {
  const userId = await requireSessionUserId();
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) redirect("/onboarding");
  return profile.id;
}
