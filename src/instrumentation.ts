/**
 * Next.js ruft `register` einmal beim Start jeder Serverinstanz auf, bevor Anfragen bearbeitet
 * werden. Hier wird die Server-Konfiguration geprüft (F-21): in Produktion bricht eine ungültige
 * Konfiguration den Start ab, statt erst bei der ersten Anfrage aufzufallen.
 *
 * Nicht während `next build`: die Konfiguration gehört zur Laufzeitumgebung, die Build-Umgebung
 * muss keine Secrets kennen. Nur in der Node.js-Runtime (der Proxy läuft auf Edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { checkServerConfigAtStartup } = await import("./lib/config/env");
  checkServerConfigAtStartup();
}
