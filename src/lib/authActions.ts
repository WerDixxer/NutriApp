"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { auth, signIn, signOut } from "./auth";
import { prisma } from "./db";
import { loginSchema, registerSchema, setupAccountSchema } from "./validation/auth";

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
  const user = await prisma.user.create({ data: { name, email, passwordHash } });
  const household = await prisma.household.create({ data: { name: `${name}s Haushalt` } });
  await prisma.householdMember.create({
    data: { householdId: household.id, userId: user.id, role: "OWNER" },
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
  await prisma.user.update({ where: { id: claimable.id }, data: { email, passwordHash } });

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof AuthError) redirect("/login?error=credentials");
    throw err;
  }
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
