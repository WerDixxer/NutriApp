import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiProfileId } from "@/lib/apiProfile";
import { getApiUserId } from "@/lib/session";
import { trendTagsPayloadSchema } from "@/lib/validation/profile";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = trendTagsPayloadSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const { tags } = parsed.data;

  const lookup = await requireApiProfileId(userId);
  if (!lookup.ok) return lookup.response;
  const profileId = lookup.profileId;

  await prisma.profile.update({
    where: { id: profileId },
    data: { subscribedTrendTags: JSON.stringify(tags) },
  });

  return NextResponse.json({ ok: true });
}
