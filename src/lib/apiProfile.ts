import { NextResponse } from "next/server";
import { prisma } from "./db";

/**
 * Profil-Lookup für API Route Handler (R5F-12). Die Anmeldung prüft die Route vorher selbst
 * (`getApiUserId`, sonst 401 "Nicht angemeldet."), damit ihre Reihenfolge von Anmelde-, Eingabe- und
 * Profilprüfung erhalten bleibt. Gelesen wird nur die Profil-ID; braucht eine Route mehr vom Profil
 * (z.B. GET/POST /api/profile), lädt sie es weiterhin selbst mit eigener Auswahl.
 */

/** Die Profil-ID des Nutzers, oder `null`, wenn er (noch) kein Profil hat. */
export async function findApiProfileId(userId: string): Promise<string | null> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { id: true } });
  return profile?.id ?? null;
}

export type RequiredApiProfile = { ok: true; profileId: string } | { ok: false; response: NextResponse };

/** Die Profil-ID des Nutzers; ohne Profil die gemeinsame Antwort 404 "Kein Profil vorhanden.". */
export async function requireApiProfileId(userId: string): Promise<RequiredApiProfile> {
  const profileId = await findApiProfileId(userId);
  if (!profileId) return { ok: false, response: NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 }) };
  return { ok: true, profileId };
}
