import { prisma } from "../db";
import { findOrCreateIngredient } from "./ingredientCatalog";
import { applyQuantityAdjustment, type QuantityAdjustment } from "./adjustQuantity";
import { computeRotationResult } from "../rotation/rotationEngine";
import { pantryItemToRotationInput } from "../rotation/pantryMapping";
import type { RotationResult } from "../rotation/types";
import type { CreatePantryItemInput, UpdatePantryItemInput } from "../validation/pantry";

export type PantryItemWithRotation = Awaited<ReturnType<typeof prisma.pantryItem.findMany>>[number] & {
  rotation: RotationResult;
};

/**
 * Alle Pantry-Funktionen nehmen `householdId` entgegen und filtern JEDE
 * Query danach, nie nur nach `id` allein. Das ist die zentrale Absicherung
 * gegen "fremde Pantry Items über eine erratene ID erreichen": eine falsche
 * `householdId` liefert konsequent "nicht gefunden", nie einen Datensatz
 * eines anderen Haushalts.
 */
export async function listPantryItems(householdId: string, now: Date = new Date()): Promise<PantryItemWithRotation[]> {
  const items = await prisma.pantryItem.findMany({
    where: { householdId },
    include: { ingredient: true },
  });

  const withRotation = items.map((item) => ({
    ...item,
    rotation: computeRotationResult(pantryItemToRotationInput(item), now),
  }));

  withRotation.sort((a, b) => b.rotation.priorityScore - a.rotation.priorityScore || a.id.localeCompare(b.id));
  return withRotation;
}

export async function createPantryItem(householdId: string, input: CreatePantryItemInput) {
  const ingredient = input.ingredientId
    ? await prisma.ingredient.findUnique({ where: { id: input.ingredientId } })
    : await findOrCreateIngredient(input.name, input.unit);

  return prisma.pantryItem.create({
    data: {
      householdId,
      ingredientId: ingredient?.id,
      name: input.name,
      quantity: input.quantity,
      remainingQuantity: input.quantity,
      unit: input.unit,
      category: input.category,
      purchaseDate: input.purchaseDate,
      expirationDate: input.expirationDate,
      expirationDateType: input.expirationDateType,
      location: input.location,
      opened: input.opened,
      cooked: input.cooked,
      notes: input.notes,
    },
    include: { ingredient: true },
  });
}

export async function updatePantryItem(householdId: string, id: string, input: UpdatePantryItemInput) {
  const existing = await prisma.pantryItem.findFirst({ where: { id, householdId } });
  if (!existing) return null;

  // Vollständiger Ersatz der Stamm-/Metadaten (siehe validation/pantry.ts).
  // `remainingQuantity` wird bewusst NICHT angefasst, das läuft ausschließlich
  // über adjustPantryItemQuantity().
  const ingredientId = input.ingredientId ?? (await findOrCreateIngredient(input.name, input.unit))?.id;

  return prisma.pantryItem.update({
    where: { id },
    data: {
      ingredientId,
      name: input.name,
      quantity: input.quantity,
      unit: input.unit,
      category: input.category ?? null,
      purchaseDate: input.purchaseDate ?? null,
      expirationDate: input.expirationDate ?? null,
      expirationDateType: input.expirationDateType,
      location: input.location,
      opened: input.opened,
      cooked: input.cooked,
      notes: input.notes ?? null,
    },
    include: { ingredient: true },
  });
}

export async function deletePantryItem(householdId: string, id: string): Promise<boolean> {
  const result = await prisma.pantryItem.deleteMany({ where: { id, householdId } });
  return result.count > 0;
}

export async function adjustPantryItemQuantity(householdId: string, id: string, adjustment: QuantityAdjustment) {
  const existing = await prisma.pantryItem.findFirst({ where: { id, householdId } });
  if (!existing) return null;

  const { remainingQuantity } = applyQuantityAdjustment(existing.remainingQuantity, adjustment);
  return prisma.pantryItem.update({
    where: { id },
    data: { remainingQuantity },
    include: { ingredient: true },
  });
}

