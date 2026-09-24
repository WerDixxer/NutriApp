import { prisma } from "../db";
import type { PantryUnit } from "@prisma/client";
import type { FoodCatalog } from "../recipes/catalog";
import { loadFoodCatalog } from "../recipes/recipeService";
import { resolveUniqueFood } from "./pantryFoods";

export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Liefert den Katalogeintrag für einen Pantry-Namen:
 *  1. ein kuratiertes Food, wenn der Name (oder ein Alias) eindeutig darauf
 *     auflöst ("Hühnchen" -> Hähnchenbrust, "Nudeln" -> Pasta): kein zweites
 *     Ingredient für ein bereits bekanntes Food,
 *  2. sonst ein bestehender Eintrag mit demselben normalisierten Namen,
 *  3. sonst wird eine freie Zutat angelegt ("Rosenkohl"), ohne sie einem
 *     ähnlich klingenden Food zuzuordnen.
 * Trägt bewusst keine erfundenen Daten (keine Nährwerte, keine Umrechnungen),
 * nur eine Identität plus optionale Standard-Einheit. Das ist kein Ersatz für
 * den NutritionProvider-Produktkatalog (Kapitel 17).
 */
export async function findOrCreateIngredient(name: string, defaultUnit?: PantryUnit, catalog?: FoodCatalog) {
  const normalizedName = normalizeIngredientName(name);
  if (!normalizedName) return null;

  const food = resolveUniqueFood(name, catalog ?? (await loadFoodCatalog()));
  if (food) {
    const canonical = await prisma.ingredient.findUnique({ where: { id: food.id } });
    if (canonical) return canonical;
  }

  const existing = await prisma.ingredient.findUnique({ where: { normalizedName } });
  if (existing) return existing;

  return prisma.ingredient.create({
    data: { name: name.trim(), normalizedName, defaultUnit },
  });
}
