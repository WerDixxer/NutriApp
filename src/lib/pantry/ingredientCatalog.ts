import { prisma } from "../db";
import type { PantryUnit } from "@prisma/client";

export function normalizeIngredientName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Findet einen bestehenden Ingredient-Katalogeintrag per normalisiertem
 * Namen oder legt einen neuen an. Trägt bewusst keine erfundenen Daten
 * (keine Nährwerte, keine Umrechnungen), nur eine Identität plus optionale
 * Standard-Einheit, damit Pantry Items später verknüpft/gruppiert werden
 * können. Das ist kein Ersatz für den NutritionProvider-Produktkatalog
 * (Kapitel 17), nur ein leichter Namens-Katalog.
 */
export async function findOrCreateIngredient(name: string, defaultUnit?: PantryUnit) {
  const normalizedName = normalizeIngredientName(name);
  if (!normalizedName) return null;

  const existing = await prisma.ingredient.findUnique({ where: { normalizedName } });
  if (existing) return existing;

  return prisma.ingredient.create({
    data: { name: name.trim(), normalizedName, defaultUnit },
  });
}
