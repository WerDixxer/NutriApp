"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "./auth";
import { prisma } from "./db";
import { createSoloHousehold } from "./household/householdService";
import { acceptInvite } from "./household/inviteService";
import { isUniqueConstraintError } from "./prismaErrors";
import { loginSchema, registerSchema, setupAccountSchema } from "./validation/auth";
import { acceptInviteSchema, registerViaInviteSchema } from "./validation/household";

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/login?error=invalid");

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: "/dashboard",
    });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=credentials");
    throw err;
  }
}

export async function registerAction(formData: FormData) {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/register?error=invalid");
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect("/register?error=exists");

  const passwordHash = await bcrypt.hash(password, 12);
  // Konto und eigener Haushalt entstehen gemeinsam oder gar nicht. Hat ein paralleler Request
  // (z.B. doppelt abgeschicktes Formular) die E-Mail inzwischen registriert, gilt dasselbe wie
  // bei der Prüfung oben.
  await prisma
    .$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash } });
      await createSoloHousehold(user.id, `${name}s Haushalt`, tx);
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) redirect("/register?error=exists");
      throw error;
    });

  try {
    await signIn("credentials", { email, password, redirectTo: "/onboarding" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=credentials");
    throw err;
  }
}

/**
 * Einmaliger Claim-Flow für aus der Single-Profile-Ära migrierte Accounts
 * ohne E-Mail/Passwort (siehe prisma/schema.prisma Kommentar bei `User`).
 */
export async function setupAccountAction(formData: FormData) {
  const parsed = setupAccountSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect("/setup-account?error=invalid");
  const { email, password } = parsed.data;

  const claimable = await prisma.user.findFirst({ where: { passwordHash: null } });
  if (!claimable) redirect("/register");

  const emailTaken = await prisma.user.findUnique({ where: { email } });
  if (emailTaken) redirect("/setup-account?error=exists");

  const passwordHash = await bcrypt.hash(password, 12);
  // Nur übernehmen, solange der Account noch kein Passwort hat: Zwei parallele Einrichtungen dürfen
  // sich nicht gegenseitig E-Mail und Passwort überschreiben. Wer zuerst schreibt, hat den Account;
  // für den anderen ist - wie bei einem späteren Aufruf - nichts mehr einzurichten.
  const claimed = await prisma.user
    .updateMany({ where: { id: claimable.id, passwordHash: null }, data: { email, passwordHash } })
    .catch((error: unknown) => {
      if (isUniqueConstraintError(error)) redirect("/setup-account?error=exists");
      throw error;
    });
  if (claimed.count === 0) redirect("/register");

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=credentials");
    throw err;
  }
}

/**
 * Registrierung über einen Household-Invite-Link (Kapitel 9): erstellt einen
 * neuen User OHNE eigenen Haushalt (anders als registerAction()) und hängt
 * ihn stattdessen direkt an den eingeladenen Haushalt. Schlägt acceptInvite()
 * fehl (Token ungültig/abgelaufen, E-Mail passt nicht), wird der gerade
 * erstellte User wieder gelöscht statt einen haushaltslosen Account
 * zurückzulassen - zu diesem Zeitpunkt existiert noch kein Profil/keine
 * sonstigen Daten, das Löschen ist also vollständig sauber.
 */
export async function registerViaInviteAction(formData: FormData) {
  const rawToken = formData.get("token");
  const tokenForRedirect = typeof rawToken === "string" ? rawToken : "";

  const parsed = registerViaInviteSchema.safeParse({
    token: rawToken,
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/invite/${tokenForRedirect}?error=invalid`);
  const { token, name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) redirect(`/invite/${token}?error=exists`);

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { name, email, passwordHash } }).catch((error: unknown) => {
    // Paralleler Request (z.B. doppelt abgeschickt) hat die E-Mail inzwischen registriert.
    if (isUniqueConstraintError(error)) redirect(`/invite/${token}?error=exists`);
    throw error;
  });

  const accepted = await acceptInvite(token, user.id, email);
  if (!accepted.ok) {
    await prisma.user.delete({ where: { id: user.id } });
    redirect(`/invite/${token}?error=invite`);
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/onboarding" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=credentials");
    throw err;
  }
}

/** Einladung annehmen als bereits angemeldeter (und bereits registrierter) Nutzer. */
export async function acceptInviteAction(formData: FormData) {
  const parsed = acceptInviteSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) redirect("/household");
  const { token } = parsed.data;

  const session = await auth();
  if (!session?.user?.id) redirect(`/login`);

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
  if (!user?.email) redirect(`/invite/${token}?error=invite`);

  const result = await acceptInvite(token, session.user.id, user.email);
  if (!result.ok) {
    const reason = result.error === "EMAIL_MISMATCH" ? "email" : result.error === "ALREADY_IN_HOUSEHOLD" ? "already" : "invalid";
    redirect(`/invite/${token}?error=${reason}`);
  }

  redirect("/household");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function getClaimableAccountName(): Promise<string | null> {
  const session = await auth();
  if (session?.user) return null;
  const claimable = await prisma.user.findFirst({ where: { passwordHash: null } });
  return claimable?.name ?? null;
}
