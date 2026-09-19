import { checkHardConstraints, type HardConstraintViolation } from "../agents/decision/hardConstraints";
import type { SearchableRecipe } from "../agents/recipeSearch";
import type { MemberPlanningContext } from "./types";

export interface MemberViolation extends HardConstraintViolation {
  householdMemberId: string;
  memberName: string | null;
}

/**
 * Eine gemeinsam geplante Mahlzeit muss die Hard Constraints JEDES geplanten
 * Mitglieds erfüllen (Abschnitt 7: "Es darf keine Person mit relevanter
 * Allergie verletzen"). Ruft die bestehende, bereits getestete
 * `checkHardConstraints()` einmal PRO Mitglied auf (kein Duplikat der
 * eigentlichen Prüf-Logik) und sammelt alle Verstöße mit Mitglied-Zuordnung.
 */
export function checkHouseholdHardConstraints(
  candidate: SearchableRecipe,
  members: MemberPlanningContext[],
  excludedIngredients: string[],
): MemberViolation[] {
  const violations: MemberViolation[] = [];
  for (const member of members) {
    const memberViolations = checkHardConstraints(candidate, {
      allergies: member.allergies,
      dietType: member.dietType,
      excludedIngredients,
    });
    for (const v of memberViolations) {
      violations.push({ ...v, householdMemberId: member.householdMemberId, memberName: member.name });
    }
  }
  return violations;
}

/** Kandidaten, die für KEIN geplantes Mitglied Hard-Constraint-Verstöße haben. */
export function filterHouseholdCandidates(
  candidates: SearchableRecipe[],
  members: MemberPlanningContext[],
  excludedIngredients: string[],
): { allowed: SearchableRecipe[]; rejected: Map<string, MemberViolation[]> } {
  const allowed: SearchableRecipe[] = [];
  const rejected = new Map<string, MemberViolation[]>();

  for (const candidate of candidates) {
    const violations = checkHouseholdHardConstraints(candidate, members, excludedIngredients);
    if (violations.length === 0) allowed.push(candidate);
    else rejected.set(candidate.id, violations);
  }

  return { allowed, rejected };
}
