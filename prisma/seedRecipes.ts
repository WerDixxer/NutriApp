import { PrismaClient } from "@prisma/client";
import { ALTERNATIVES } from "../src/lib/recipes/data/alternatives";
import { buildRecipes, recipeIngredientRowData, recipeRowData, validateSeedData } from "../src/lib/recipes/data/build";
import { FOODS } from "../src/lib/recipes/data/foods";

/**
 * Eigenständiges, IDEMPOTENTES Seed-Skript für Foods, Alternativen und die 60
 * Basis-Rezepte (separat von prisma/seed.ts, das Rezepte per `create` ohne
 * Duplikatsprüfung anlegt). Schlüssel: `Ingredient.slug` bzw. `Recipe.slug`.
 * Ein erneuter Lauf aktualisiert die Zeilen, statt Duplikate zu erzeugen.
 *
 * Bestehende Ingredient-Zeilen, die beim Anlegen von Pantry-Einträgen entstanden
 * sind (gleicher normalisierter Name, z.B. "hähnchenbrust"), werden adoptiert:
 * sie bekommen Slug/Nährwerte, ihre ID (und damit alle Pantry-/Preis-Verweise)
 * bleibt unverändert.
 */
const prisma = new PrismaClient();

const nullable = <T>(value: T | undefined | null) => value ?? null;

async function seedFoods(): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();

  for (const food of FOODS) {
    const normalizedName = food.name.trim().toLowerCase();
    const n = food.nutrition;
    const data = {
      name: food.name,
      slug: food.slug,
      category: food.category,
      dietClass: food.dietClass,
      aliases: JSON.stringify(food.aliases),
      allergens: JSON.stringify(food.allergens),
      negligible: food.negligible ?? false,
      unitGrams: food.unitGrams ? JSON.stringify(food.unitGrams) : null,
      kcalPer100: nullable(n?.kcal),
      proteinPer100G: nullable(n?.proteinG),
      carbsPer100G: nullable(n?.carbsG),
      fatPer100G: nullable(n?.fatG),
      fiberPer100G: nullable(n?.fiberG),
      sugarPer100G: nullable(n?.sugarG),
      saturatedFatPer100G: nullable(n?.saturatedFatG),
      sodiumPer100Mg: nullable(n?.sodiumMg),
    };

    const existing =
      (await prisma.ingredient.findUnique({ where: { slug: food.slug } })) ??
      (await prisma.ingredient.findUnique({ where: { normalizedName } }));

    const row = existing
      ? await prisma.ingredient.update({ where: { id: existing.id }, data })
      : await prisma.ingredient.create({ data: { ...data, normalizedName } });
    idBySlug.set(food.slug, row.id);
  }
  return idBySlug;
}

async function seedAlternatives(idBySlug: Map<string, string>): Promise<number> {
  const fromIds = Array.from(new Set(ALTERNATIVES.map((a) => idBySlug.get(a.from)!)));
  await prisma.ingredientAlternative.deleteMany({ where: { fromFoodId: { in: fromIds } } });

  await prisma.ingredientAlternative.createMany({
    data: ALTERNATIVES.map((a) => ({
      fromFoodId: idBySlug.get(a.from)!,
      toFoodId: idBySlug.get(a.to)!,
      type: a.type,
      requiresContext: a.requiresContext,
      note: a.note ?? null,
    })),
  });
  return ALTERNATIVES.length;
}

async function seedRecipes(idBySlug: Map<string, string>): Promise<number> {
  const recipes = buildRecipes();

  for (const r of recipes) {
    const data = {
      ...recipeRowData(r),
      sourceType: r.source.type,
      sourceProvider: r.source.provider,
      sourceExternalId: r.source.externalId,
    };

    // Adoptiert ein gleichnamiges Rezept ohne Slug, statt ein Duplikat anzulegen.
    const existing =
      (await prisma.recipe.findUnique({ where: { slug: r.slug } })) ??
      (await prisma.recipe.findFirst({ where: { name: r.name, slug: null, isCustom: false } }));

    const recipe = existing
      ? await prisma.recipe.update({ where: { id: existing.id }, data: { ...data, slug: r.slug } })
      : await prisma.recipe.create({ data: { ...data, slug: r.slug } });

    await prisma.recipeIngredient.deleteMany({ where: { recipeId: recipe.id } });
    await prisma.recipeIngredient.createMany({
      data: r.ingredients.map((ingredient, position) => ({
        recipeId: recipe.id,
        ...recipeIngredientRowData(ingredient, position, idBySlug.get(ingredient.foodId)!),
      })),
    });
  }
  return recipes.length;
}

async function main() {
  const problems = validateSeedData();
  if (problems.length > 0) {
    throw new Error(`Seed-Daten inkonsistent:\n- ${problems.join("\n- ")}`);
  }

  console.log(`Seede ${FOODS.length} Foods...`);
  const idBySlug = await seedFoods();

  console.log(`Seede ${ALTERNATIVES.length} Alternativen...`);
  await seedAlternatives(idBySlug);

  console.log("Seede Rezepte...");
  const recipeCount = await seedRecipes(idBySlug);

  // Vor diesem Schema waren eigene Rezepte nicht als "user" markiert.
  const backfilled = await prisma.recipe.updateMany({
    where: { isCustom: true, sourceType: "internal" },
    data: { sourceType: "user" },
  });

  const totals = {
    foods: await prisma.ingredient.count({ where: { slug: { not: null } } }),
    alternatives: await prisma.ingredientAlternative.count(),
    recipes: await prisma.recipe.count({ where: { slug: { not: null } } }),
    recipeIngredients: await prisma.recipeIngredient.count(),
  };
  console.log(`Fertig. ${recipeCount} Rezepte verarbeitet, ${backfilled.count} eigene Rezepte als "user" markiert.`);
  console.log("DB-Stand:", totals);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
