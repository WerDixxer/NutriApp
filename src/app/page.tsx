import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireSessionUserId } from "@/lib/session";

export default async function Home() {
  const userId = await requireSessionUserId();
  const profile = await prisma.profile.findUnique({ where: { userId } });
  redirect(profile ? "/dashboard" : "/onboarding");
}
