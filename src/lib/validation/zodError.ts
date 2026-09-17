import type { z } from "zod";

/** Erste, für Nutzer lesbare Fehlermeldung aus einem fehlgeschlagenen zod-Parse. */
export function firstZodIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Ungültige Eingabe.";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
