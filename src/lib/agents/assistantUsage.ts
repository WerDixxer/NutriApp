import { prisma } from "../db";
import { isUniqueConstraintError } from "../prismaErrors";

/**
 * Schutz des Assistants vor unkontrollierter Nutzung (F-20), gespeichert in AssistantRequest (siehe
 * prisma/schema.prisma), damit er auch mit mehreren Serverinstanzen gilt.
 *
 * Eine Anfrage zählt, sobald sie hier zugelassen wird - also erst nach Anmeldung, gültigem Body und
 * Profil. Abgelehnte Anfragen (Limit erreicht, schon eine aktive Anfrage) zählen nicht.
 * Die Limits sind Produktentscheidungen und bewusst nicht per Umgebungsvariable änderbar.
 */
export const ASSISTANT_REQUEST_LIMITS = [
  { windowMs: 60 * 60 * 1000, maxRequests: 20 }, // pro Stunde
  { windowMs: 24 * 60 * 60 * 1000, maxRequests: 100 }, // pro 24 Stunden
] as const;

/**
 * Nach dieser Zeit gilt eine noch als aktiv markierte Anfrage als verwaist (z.B. Prozess abgestürzt)
 * und blockiert den Nutzer nicht mehr. Deutlich länger als eine Anfrage höchstens dauern kann:
 * 2 LLM-Aufrufe x 2 Versuche x Timeout (siehe anthropicProvider.ts) = 2 Minuten.
 */
export const STALE_ACTIVE_REQUEST_MS = 5 * 60 * 1000;

export type AssistantAdmission =
  | { ok: true; requestId: string }
  | { ok: false; reason: "ACTIVE_REQUEST" }
  | { ok: false; reason: "RATE_LIMITED"; retryAfterSeconds: number };

/** Gibt Sperren des Nutzers frei, deren Anfrage seit STALE_ACTIVE_REQUEST_MS nicht beendet wurde. */
async function releaseStaleActiveRequest(userId: string, now: Date): Promise<void> {
  await prisma.assistantRequest.updateMany({
    where: { activeUserId: userId, startedAt: { lt: new Date(now.getTime() - STALE_ACTIVE_REQUEST_MS) } },
    data: { activeUserId: null, finishedAt: now },
  });
}

/**
 * Sekunden, bis im überschrittenen Fenster wieder Platz ist: dann, wenn die `maxRequests`-jüngste
 * frühere Anfrage aus dem Fenster fällt. `null`, wenn das Fenster nicht überschritten ist.
 */
async function secondsUntilWindowHasRoom(userId: string, excludeRequestId: string, windowMs: number, maxRequests: number, now: Date): Promise<number | null> {
  const windowStart = new Date(now.getTime() - windowMs);
  const earlier = await prisma.assistantRequest.findMany({
    where: { userId, id: { not: excludeRequestId }, startedAt: { gt: windowStart } },
    orderBy: { startedAt: "desc" },
    take: maxRequests,
    select: { startedAt: true },
  });
  if (earlier.length < maxRequests) return null;
  const freesUpAt = earlier[maxRequests - 1].startedAt.getTime() + windowMs;
  return Math.max(1, Math.ceil((freesUpAt - now.getTime()) / 1000));
}

/**
 * Lässt eine Assistant-Anfrage zu oder lehnt sie ab. Reihenfolge:
 * 1. verwaiste Sperre des Nutzers freigeben,
 * 2. Anfrage mit Sperre anlegen - der Unique-Index auf `activeUserId` verhindert atomar eine zweite
 *    aktive Anfrage (auch bei exakt gleichzeitigen Requests),
 * 3. erst dann zählen: Da nur eine Anfrage je Nutzer aktiv sein kann, zählt keine parallele mit.
 *    Ist ein Fenster überschritten, wird die gerade angelegte Zeile wieder gelöscht (zählt nicht).
 */
export async function admitAssistantRequest(userId: string, now: Date = new Date()): Promise<AssistantAdmission> {
  await releaseStaleActiveRequest(userId, now);

  let requestId: string;
  try {
    requestId = (await prisma.assistantRequest.create({ data: { userId, startedAt: now, activeUserId: userId }, select: { id: true } })).id;
  } catch (error) {
    if (isUniqueConstraintError(error)) return { ok: false, reason: "ACTIVE_REQUEST" };
    throw error;
  }

  const waits = await Promise.all(
    ASSISTANT_REQUEST_LIMITS.map(({ windowMs, maxRequests }) => secondsUntilWindowHasRoom(userId, requestId, windowMs, maxRequests, now)),
  );
  const exceeded = waits.filter((seconds): seconds is number => seconds !== null);
  if (exceeded.length > 0) {
    await prisma.assistantRequest.delete({ where: { id: requestId } });
    return { ok: false, reason: "RATE_LIMITED", retryAfterSeconds: Math.max(...exceeded) };
  }
  return { ok: true, requestId };
}

/** Beendet eine zugelassene Anfrage: Sperre frei, die Zeile bleibt für die Zählung erhalten. */
export async function finishAssistantRequest(requestId: string, now: Date = new Date()): Promise<void> {
  await prisma.assistantRequest.updateMany({ where: { id: requestId }, data: { activeUserId: null, finishedAt: now } });
}
