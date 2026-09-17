import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { profilePayloadSchema } from "@/lib/validation/profile";
import { firstZodIssue } from "@/lib/validation/zodError";

export type { ProfilePayload, TrainingSessionPayload } from "@/lib/validation/profile";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

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
  if (!profile) return NextResponse.json({ profile: null });

  return NextResponse.json({
    profile: {
      ...profile,
      name: profile.user.name,
      email: profile.user.email,
      subscribedTrendTags: JSON.parse(profile.subscribedTrendTags) as string[],
    },
  });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const parsed = profilePayloadSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const existing = await prisma.profile.findUnique({ where: { userId } });

  const scalarData = {
    age: body.age,
    sex: body.sex,
    heightCm: body.heightCm,
    weightKg: body.weightKg,
    activityLevel: body.activityLevel,
    goal: body.goal,
    goalRateKgPerWeek: body.goalRateKgPerWeek,
    sportType: body.sportType,
    dietType: body.dietType,
  };

  const profileId = existing
    ? existing.id
    : (await prisma.profile.create({ data: { ...scalarData, userId } })).id;

  if (existing) {
    await prisma.profile.update({ where: { id: profileId }, data: scalarData });
    await prisma.profileTag.deleteMany({
      where: {
        OR: [
          { likedByProfileId: profileId },
          { dislikedByProfileId: profileId },
          { allergyOfProfileId: profileId },
          { priorityOfProfileId: profileId },
        ],
      },
    });
    await prisma.trainingSession.deleteMany({ where: { profileId } });
    // Bereits generierte Pläne beruhen auf alten Zielwerten -> verwerfen.
    await prisma.mealPlanDay.deleteMany({ where: { profileId } });
  }

  await prisma.profile.update({
    where: { id: profileId },
    data: {
      likedFoods: { create: body.likedFoods.map((label) => ({ label })) },
      dislikedFoods: { create: body.dislikedFoods.map((label) => ({ label })) },
      allergies: { create: body.allergies.map((label) => ({ label })) },
      priorities: { create: body.priorities.map((label) => ({ label })) },
      trainingSessions: { create: body.trainingSessions },
    },
  });

  return NextResponse.json({ profileId });
}
