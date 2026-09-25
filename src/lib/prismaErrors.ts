import { Prisma } from "@prisma/client";

/**
 * Unique-Constraint verletzt (P2002). Nach einer vorherigen Existenzprüfung heißt das fast immer:
 * Ein paralleler Request hat denselben Datensatz gerade angelegt. Aufrufer behandeln das wie das
 * Ergebnis ihrer eigenen Prüfung (Datensatz existiert bereits), statt mit einem 500 abzubrechen.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
