import type { DietType } from "@prisma/client";
import { matchesAllergen, ingredientListIncludes } from "../../foodMatching";
import type { SearchableRecipe } from "../recipeSearch";

export interface HardConstraintContext {
  /** Bekannte Allergien (Profil + explizit in der Nachricht genannt). */
  allergies: string[];
  dietType: DietType;
  /** Explizit in dieser Nachricht ausgeschlossene Zutaten. */
  excludedIngredients: string[];
}

export type HardConstraintName = "allergies" | "dietaryStyle" | "excludedIngredients";

export interface HardConstraintViolation {
  constraint: HardConstraintName;
  detail: string;
}

/**
 * Prioritäten 1-3 (Allergien/Food Safety, Dietary Style, harte Ausschlüsse).
 * Eliminiert Kandidaten vollständig, unabhängig vom späteren Score. Gibt
 * ALLE Verstöße zurück (nicht nur den ersten), damit rejectedCandidates
 * später nachvollziehbar begründet werden kann.
 */
export function checkHardConstraints(
  candidate: SearchableRecipe,
  ctx: HardConstraintContext,
): HardConstraintViolation[] {
  const violations: HardConstraintViolation[] = [];

  if (ctx.allergies.length > 0 && matchesAllergen(candidate.allergens, ctx.allergies)) {
    violations.push({
      constraint: "allergies",
      detail: `Enthält ein Allergen aus deiner Liste (${ctx.allergies.join(", ")}).`,
    });
  }

  if (!candidate.dietTypes.includes(ctx.dietType)) {
    violations.push({ constraint: "dietaryStyle", detail: "Passt nicht zu deiner Ernährungsform." });
  }

  const hitExcluded = ctx.excludedIngredients.filter((term) => ingredientListIncludes(candidate.ingredients, term));
  if (hitExcluded.length > 0) {
    violations.push({
      constraint: "excludedIngredients",
      detail: `Enthält ausgeschlossene Zutat(en): ${hitExcluded.join(", ")}.`,
    });
  }

  return violations;
}

/** Welche Hard Constraints in diesem Durchlauf tatsächlich geprüft wurden (für die Audit-Liste `constraintsApplied`). */
export function buildConstraintsAppliedList(ctx: HardConstraintContext): HardConstraintName[] {
  const applied: HardConstraintName[] = ["dietaryStyle"];
  if (ctx.allergies.length > 0) applied.push("allergies");
  if (ctx.excludedIngredients.length > 0) applied.push("excludedIngredients");
  return applied;
}
