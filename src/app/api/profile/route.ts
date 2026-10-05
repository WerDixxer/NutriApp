import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { todayForUser } from "@/lib/calendarDate";
import { prisma } from "@/lib/db";
import { hasStoredEditableDays } from "@/lib/generateMealPlan";
import { PLAN_RELEVANT_PROFILE_SELECT, hasPlanRelevantChange, toPlanRelevantProfile } from "@/lib/planRelevantProfile";
import { getApiUserId } from "@/lib/session";
import { profilePayloadSchema } from "@/lib/validation/profile";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";
import { readJsonColumn } from "@/lib/validation/jsonColumn";
import { storedStringListSchema } from "@/lib/validation/jsonColumnSchemas";

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

  // Unlesbare Trend-Tags werfen JsonColumnError statt still [] zu liefern: Die Trends-Seite speichert
  // beim nächsten Umschalten die vollständige Liste, ein Fallback würde die gespeicherten Tags überschreiben.
  const subscribedTrendTags = readJsonColumn(
    { model: "Profile", id: `userId=${userId}`, column: "subscribedTrendTags" },
    profile.subscribedTrendTags,
    storedStringListSchema,
  );
  return NextResponse.json({ profile: { ...profile, subscribedTrendTags } });
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
  const { profileId, planRelevantChange } = await prisma.$transaction(async (tx) => {
    // Vorher-Stand in der Sicht des Planers - dieselbe Auswahl, über die der Planer das Profil liest.
    const existing = await tx.profile.findUnique({ where: { userId }, select: PLAN_RELEVANT_PROFILE_SELECT });
    const id = existing ? existing.id : (await tx.profile.create({ data: { ...scalarData, userId } })).id;

    if (existing) {
      await tx.profile.update({ where: { id }, data: scalarData });
      await tx.profileTag.deleteMany({
        where: {
          OR: [{ likedByProfileId: id }, { dislikedByProfileId: id }, { allergyOfProfileId: id }, { priorityOfProfileId: id }],
        },
      });
      await tx.trainingSession.deleteMany({ where: { profileId: id } });
      // Tagespläne bleiben unverändert (R5E): vergangene sind Historie, und heutige/künftige werden
      // nur auf ausdrücklichen Wunsch neu geplant, nie still beim Speichern des Profils.
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
    return { profileId: id, planRelevantChange: existing !== null && hasPlanRelevantChange(toPlanRelevantProfile(existing), body) };
  });

  // Die Pläne bleiben hier immer unverändert. `planAdaptation.needed` sagt dem Client nur, dass er fragen
  // sollte, ob heutige und künftige Pläne neu geplant werden (POST /api/plan/regenerate, R5E).
  const needed = planRelevantChange && (await hasStoredEditableDays(profileId, todayForUser()));
  return NextResponse.json({ profileId, planAdaptation: { needed } });
}
