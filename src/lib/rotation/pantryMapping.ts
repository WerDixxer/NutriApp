import type { RotationItemInput } from "./types";

/** Die Teilmenge der Prisma-`PantryItem`-Felder, die das Rotation-Scoring braucht. */
export interface PantryItemLike {
  id: string;
  name: string;
  opened: boolean;
  cooked: boolean;
  quantity: number;
  remainingQuantity: number;
  expirationDate: Date | null;
  expirationDateType: string;
  purchaseDate: Date | null;
  location: string;
}

/** Einziger Übersetzer DB-Zeile -> RotationItemInput, damit dieses Mapping nicht mehrfach abweichend nachgebaut wird. */
export function pantryItemToRotationInput(item: PantryItemLike): RotationItemInput {
  return {
    id: item.id,
    name: item.name,
    opened: item.opened,
    cooked: item.cooked,
    quantity: item.quantity,
    remainingQuantity: item.remainingQuantity,
    expirationDate: item.expirationDate,
    expirationDateType: item.expirationDateType as RotationItemInput["expirationDateType"],
    purchaseDate: item.purchaseDate,
    location: item.location,
  };
}
