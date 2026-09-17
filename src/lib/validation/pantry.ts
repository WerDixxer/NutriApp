import { z } from "zod";

export const pantryUnitSchema = z.enum(["G", "KG", "ML", "L", "PIECE", "PACK", "PORTION"]);
export const pantryLocationSchema = z.enum(["FRIDGE", "FREEZER", "PANTRY", "CUPBOARD", "OTHER"]);
export const expirationDateTypeSchema = z.enum(["EXACT", "ESTIMATED", "UNKNOWN"]);

const pantryItemFields = {
  name: z.string().trim().min(1, "Name fehlt.").max(120),
  ingredientId: z.string().min(1).optional(),
  quantity: z.number().positive("Menge muss größer als 0 sein.").max(100000),
  unit: pantryUnitSchema,
  category: z.string().trim().max(60).optional(),
  purchaseDate: z.coerce.date().optional(),
  expirationDate: z.coerce.date().optional(),
  expirationDateType: expirationDateTypeSchema.default("UNKNOWN"),
  location: pantryLocationSchema.default("OTHER"),
  opened: z.boolean().default(false),
  cooked: z.boolean().default(false),
  notes: z.string().trim().max(500).optional(),
};

/**
 * EXACT/ESTIMATED brauchen ein Datum (sonst wäre der Typ eine leere
 * Behauptung), UNKNOWN darf keins tragen (sonst wäre das Datum stillschweigend
 * doch "bekannt").
 */
function expirationConsistent(data: { expirationDateType?: string; expirationDate?: Date }): boolean {
  if (data.expirationDateType === "UNKNOWN") return data.expirationDate === undefined;
  return data.expirationDate !== undefined;
}

const EXPIRATION_ISSUE = {
  message: "expirationDate und expirationDateType passen nicht zusammen (EXACT/ESTIMATED brauchen ein Datum, UNKNOWN keins).",
  path: ["expirationDate"],
};

// Bewusst kein partielles PATCH-Schema: die Edit-UI lädt immer den
// vollständigen aktuellen Datensatz, zeigt ihn im selben Formular wie beim
// Anlegen und schickt ihn komplett zurück. Das vermeidet die Inkonsistenz-
// Fallstricke eines sparsen Updates (z.B. nur `expirationDate` ohne
// `expirationDateType` ändern) komplett, statt sie nachträglich zu mergen.
// `remainingQuantity` ist bewusst kein Teil dieses Schemas: Mengenänderungen
// laufen ausschließlich über adjustPantryQuantitySchema/applyQuantityAdjustment.
export const createPantryItemSchema = z.object(pantryItemFields).refine(expirationConsistent, EXPIRATION_ISSUE);
export const updatePantryItemSchema = createPantryItemSchema;

export const adjustPantryQuantitySchema = z.object({
  type: z.enum(["add", "consume", "set"]),
  amount: z.number().nonnegative("Menge darf nicht negativ sein.").max(100000),
});

export type CreatePantryItemInput = z.infer<typeof createPantryItemSchema>;
export type UpdatePantryItemInput = z.infer<typeof updatePantryItemSchema>;
export type AdjustPantryQuantityInput = z.infer<typeof adjustPantryQuantitySchema>;
