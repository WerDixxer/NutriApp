import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import { recipePayloadSchema } from "@/lib/validation/recipes";
import { firstZodIssue } from "@/lib/validation/zodError";
import { invalidJsonBodyResponse, readJsonBody } from "@/lib/validation/jsonBody";

export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ recipes: [] });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ recipes: [] });

  const recipes = await prisma.recipe.findMany({
    where: { ownerProfileId: profile.id, isCustom: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ recipes });
}

export async function POST(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return invalidJsonBodyResponse();
  const parsed = recipePayloadSchema.safeParse(jsonBody.value);
  if (!parsed.success) {
    return NextResponse.json({ error: firstZodIssue(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) {
    return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });
  }

  const recipe = await prisma.recipe.create({
    data: {
      name: body.name,
      description: body.description || "Eigenes Rezept",
      kcal: body.kcal,
      proteinG: body.proteinG,
      carbsG: body.carbsG,
      fatG: body.fatG,
      prepTimeMin: body.prepTimeMin,
      servings: body.servings || 1,
      mealSlots: JSON.stringify(body.mealSlots),
      dietTypes: JSON.stringify(body.dietTypes),
      allergens: JSON.stringify(body.allergens),
      tags: JSON.stringify(body.tags ?? []),
      ingredients: JSON.stringify(body.ingredients),
      instructions: JSON.stringify(body.instructions),
      isCustom: true,
      sourceType: "user",
      ownerProfileId: profile.id,
    },
  });

  // Bereits generierte Pläne kennen dieses neue Rezept noch nicht -> neu generieren lassen,
  // damit es ab sofort in Vorschläge einfließen kann.
  await prisma.mealPlanDay.deleteMany({ where: { profileId: profile.id } });

  return NextResponse.json({ recipe });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const profile = await prisma.profile.findUnique({ where: { userId } });
  if (!profile) return NextResponse.json({ error: "Kein Profil vorhanden." }, { status: 404 });

  try {
    await prisma.recipe.deleteMany({ where: { id, ownerProfileId: profile.id, isCustom: true } });
  } catch (error) {
    if (isForeignKeyConstraintError(error)) {
      return NextResponse.json(
        { error: "Das Rezept kann nicht gelöscht werden, weil es noch in einem Essens- oder Wochenplan verwendet wird." },
        { status: 409 },
      );
    }
    throw error;
  }
  return NextResponse.json({ ok: true });
}

/**
 * Ein eigenes Rezept kann nur an Planeinträgen hängen bleiben: MealPlanItem (Tages-/Wochenplan) und
 * MealPlanMeal (Essensplan des Haushalts) verweisen ohne onDelete auf Recipe, also Restrict. Alle
 * anderen Verweise auf Recipe werden beim Löschen mitgelöscht (Zutatenzeilen) oder geleert
 * (Log-Einträge, Import-Kandidaten). Belegt in src/test/referentialIntegrity.test.ts.
 */
function isForeignKeyConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}
