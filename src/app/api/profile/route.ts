import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { profilePayloadSchema } from "@/lib/validation/profile";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

export type { ProfilePayload, TrainingSessionPayload } from "@/lib/validation/profile";

/**
 * Genau die Felder, die Onboarding (OnboardingForm) und Trends-Seite (TrendsGrid) lesen. Bewusst
 * eine explizite Auswahl statt `include`: der User-Datensatz (u.a. passwordHash) darf nie in die
 * Antwort gelangen, und neue Server-Felder landen nicht automatisch im Browser.
 */
const CLIENT_PROFILE_SELECT = {
  age: true,
  sex: true,
  heightCm: true,
  weightKg: true,
  activityLevel: true,
  goal: true,
  goalRateKgPerWeek: true,
  sportType: true,
  dietType: true,
  subscribedTrendTags: true,
  likedFoods: { select: { label: true } },
  dislikedFoods: { select: { label: true } },
  allergies: { select: { label: true } },
  priorities: { select: { label: true } },
  trainingSessions: { select: { weekday: true, startTime: true, durationMin: true, sportType: true, intensity: true } },
} satisfies Prisma.ProfileSelect;

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { userId }, select: CLIENT_PROFILE_SELECT });
  if (!profile) return NextResponse.json({ profile: null });

  return NextResponse.json({
    profile: { ...profile, subscribedTrendTags: JSON.parse(profile.subscribedTrendTags) as string[] },
  });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = profilePayloadSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

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

  // Eine Transaktion: Tags (auch Allergien) werden gelöscht und neu angelegt - schlägt ein Schritt
  // fehl, darf das Profil nicht ohne Allergien oder mit halb übernommenen Werten zurückbleiben.
  const profileId = await prisma.$transaction(async (tx) => {
    const existing = await tx.profile.findUnique({ where: { userId }, select: { id: true } });
    const id = existing ? existing.id : (await tx.profile.create({ data: { ...scalarData, userId } })).id;

    if (existing) {
      await tx.profile.update({ where: { id }, data: scalarData });
      await tx.profileTag.deleteMany({
        where: {
          OR: [{ likedByProfileId: id }, { dislikedByProfileId: id }, { allergyOfProfileId: id }, { priorityOfProfileId: id }],
        },
      });
      await tx.trainingSession.deleteMany({ where: { profileId: id } });
      // Bereits generierte Pläne beruhen auf alten Zielwerten -> verwerfen.
      await tx.mealPlanDay.deleteMany({ where: { profileId: id } });
    }

    await tx.profile.update({
      where: { id },
      data: {
        likedFoods: { create: body.likedFoods.map((label) => ({ label })) },
        dislikedFoods: { create: body.dislikedFoods.map((label) => ({ label })) },
        allergies: { create: body.allergies.map((label) => ({ label })) },
        priorities: { create: body.priorities.map((label) => ({ label })) },
        trainingSessions: { create: body.trainingSessions },
      },
    });
    return id;
  });

  return NextResponse.json({ profileId });
}
