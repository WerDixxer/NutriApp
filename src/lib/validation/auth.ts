import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt.").max(80),
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben."),
});

export const setupAccountSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(8, "Passwort muss mindestens 8 Zeichen haben."),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ungültige E-Mail-Adresse."),
  password: z.string().min(1, "Passwort fehlt."),
});
