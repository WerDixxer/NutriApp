import { notFound, redirect } from "next/navigation";
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

/**
 * Für API Route Handler: leitet die Haushalts-ID des eingeloggten Nutzers
 * ausschließlich aus der Session ab (nie aus einem Client-Parameter). Das
 * ist die zentrale Absicherung dafür, dass Pantry-Routen niemals eine vom
 * Client übergebene `householdId` vertrauen. Gibt `null`, wenn nicht
 * angemeldet oder (noch) keinem Haushalt zugeordnet.
 */
export async function getApiHouseholdId(): Promise<string | null> {
  const userId = await getApiUserId();
  if (!userId) return null;
  const membership = await prisma.householdMember.findUnique({ where: { userId }, select: { householdId: true } });
  return membership?.householdId ?? null;
}

/**
 * Für Server Components/Pages: wie `getApiHouseholdId()`, leitet aber zu
 * /login (nicht angemeldet) bzw. /household (angemeldet, aber aktuell keinem
 * Haushalt zugeordnet) um, statt einen Fehler zu werfen. Der zweite Fall war
 * vor Kapitel 9 nie erreichbar (jede Registrierung legt sofort einen eigenen
 * Haushalt an); seit `leaveHousehold()`/Mitglied-Entfernung ist er es, daher
 * ein sauberer Redirect statt eines rohen Error-Boundary-Absturzes auf
 * Pantry/Budget.
 */
export async function requireHouseholdId(): Promise<string> {
  const userId = await requireSessionUserId();
  const membership = await prisma.householdMember.findUnique({ where: { userId }, select: { householdId: true } });
  if (!membership) redirect("/household");
  return membership.householdId;
}

/**
 * Zugriff auf interne Entwickler-/Review-Werkzeuge (Kapitel 19, z.B. `/internal/recipe-review`).
 * Es gibt bewusst noch keine Rollen-/Permission-Engine (siehe Kapitel-Auftrag Abschnitt 6: keine
 * neue Rollenarchitektur bauen). Zugriff braucht eine eingeloggte Session UND eine der beiden:
 *  - die E-Mail steht in der kommagetrennten Env-Variable `INTERNAL_REVIEW_EMAILS`, ODER
 *  - die Variable ist nicht gesetzt UND es ist keine Produktionsumgebung (`NODE_ENV !==
 *    "production"`) - dann darf lokal/in Preview-Umgebungen jeder eingeloggte Nutzer zugreifen,
 *    damit interne Tools ohne Konfigurationsaufwand nutzbar sind.
 * In Produktion ohne gesetzte Variable ist der Zugriff für niemanden möglich (sicher
 * geschlossen). Nicht eingeloggt -> `/login`; eingeloggt, aber nicht zugelassen -> `notFound()`
 * (404 statt 403), damit die Route für Unbefugte nicht als "existiert, aber verboten" erkennbar
 * wird.
 */
export async function requireInternalReviewAccess(): Promise<{ userId: string; email: string | null }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");

  const allowlist = (process.env.INTERNAL_REVIEW_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const email = session.user.email ?? null;
  const allowed = allowlist.length > 0 ? email !== null && allowlist.includes(email.toLowerCase()) : process.env.NODE_ENV !== "production";
  if (!allowed) notFound();

  return { userId, email };
}
