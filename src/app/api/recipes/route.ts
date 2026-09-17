import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getApiUserId } from "@/lib/session";
import type { DietType, MealSlot } from "@prisma/client";

interface RecipePayload {
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  prepTimeMin: number;
  servings: number;
  mealSlots: MealSlot[];
  dietTypes: DietType[];
  allergens: string[];
  tags?: string[];
  ingredients: string[];
  instructions: string[];
}

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

  const body = (await request.json()) as RecipePayload;

  if (!body.name || !body.kcal || body.mealSlots.length === 0 || body.dietTypes.length === 0) {
    return NextResponse.json({ error: "Pflichtfelder fehlen." }, { status: 400 });
  }

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

  await prisma.recipe.deleteMany({ where: { id, ownerProfileId: profile.id, isCustom: true } });
  return NextResponse.json({ ok: true });
}
