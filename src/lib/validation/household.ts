import { z } from "zod";

export const updateHouseholdSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt.").max(80),
  currency: z.enum(["EUR"]).default("EUR"),
});

/**
 * `role` ist absichtlich auf MEMBER fixiert (kein Enum mit OWNER-Option):
 * Ownership darf ausschließlich per expliziter Übertragung wechseln, nie per
 * Invite, siehe schema.prisma-Kommentar bei HouseholdInvite.
 */
export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  role: z.literal("MEMBER").default("MEMBER"),
});

export const transferOwnershipSchema = z.object({
  targetMemberId: z.string().min(1, "Zielmitglied fehlt."),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Token fehlt."),
});

export const registerViaInviteSchema = z.object({
  token: z.string().min(1, "Token fehlt."),
  name: z.string().trim().min(1, "Name fehlt.").max(80),
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben."),
});

export type UpdateHouseholdInput = z.infer<typeof updateHouseholdSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
export type RegisterViaInviteInput = z.infer<typeof registerViaInviteSchema>;
