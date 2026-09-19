import { randomBytes, createHash } from "node:crypto";

/**
 * Invite-Tokens: 256 Bit Zufall (praktisch nicht erratbar), nur der SHA-256-
 * Hash wird persistiert (siehe schema.prisma:HouseholdInvite). bcrypt/scrypt
 * sind hier bewusst NICHT nötig - die sind für niedrig-entropische,
 * menschen-gewählte Geheimnisse (Passwörter) gedacht, bei denen langsames
 * Hashing Brute-Force erschwert. Ein zufälliger 256-Bit-Token hat genug
 * Entropie, dass ein schneller, deterministischer Hash für den DB-Lookup die
 * richtige (und einzige in diesem Projekt bereits verfügbare) Wahl ist, ohne
 * eine neue Dependency einzuführen (node:crypto ist eingebaut).
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
