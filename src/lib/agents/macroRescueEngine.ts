import { prisma } from "../db";
import { getRemainingDailyTargets } from "./remainingTargets";
import { dbRecipeToSearchable } from "./searchableRecipe";
import { resolveMealSlot } from "./recipeSearch";
import { selectRescueSolutions } from "./macroRescue/selectRescueSolutions";
import { DEFAULT_MACRO_TOLERANCES, type MacroTolerances } from "./macroRescue/tolerances";
import { DEFAULT_MACRO_LOSS_WEIGHTS } from "./macroRescue/lossWeights";
import type { HardConstraintContext } from "./decision/hardConstraints";
import type { MacroRescueResult, MacroRescueTargets } from "./macroRescue/types";
import { attachStructuredIngredients, loadFoodCatalog } from "../recipes/recipeService";

export interface MacroRescueInput {
  profileId: string;
  now?: Date;
  /** Überschreibt einzelne Zielwerte statt des vollen Tagesrests, z.B. "ich habe noch 300 kcal übrig". */
  targetsOverride?: Partial<MacroRescueTargets>;
  excludedIngredients?: string[];
  /** Vom Nutzer genannte vorhandene Zutaten. Aktuell nicht ausgewertet (kein Pantry-Modell, Kapitel 6), nur entgegengenommen. */
  availableIngredients?: string[];
  mealType?: string;
  maxCookingTimeMin?: number;
  /**
   * Noch nicht ausgewertet. Seit Kapitel 8 existiert ein echtes Budget-/Preis-
   * Modell (budget/mealCost.ts), aber Rezepte haben weiterhin nur unstrukturierte
   * Freitext-Zutaten, ohne echte Mengen-Zuordnung wäre ein Kostenvergleich hier
   * geraten statt berechnet. Bleibt daher entgegengenommen, aber ungenutzt.
   */
  budgetEur?: number;
  tolerances?: Partial<MacroTolerances>;
  /** Wie viele Lösungen zurückgegeben werden (beste zuerst). Default 3. */
  limit?: number;
}

/**
 * MacroRescueEngine: "Wie kann ich deine verbleibenden Ernährungsziele
 * möglichst gut abdecken?" — bewusst getrennt von der Decision Engine
 * ("Welche Mahlzeit wähle ich für dich aus?"), auch wenn beide dieselbe
 * Hard-Constraint-Logik (Allergien/Dietary Style/Ausschlüsse) wiederverwenden.
 * Lädt reale Daten (Profil, Rezeptdatenbank, Tagesrest über die geteilte
 * `getRemainingDailyTargets()`) und delegiert die eigentliche Optimierung an
 * die reine, unit-getestete Funktion `selectRescueSolutions()`.
 */
export class MacroRescueEngine {
  readonly name = "macro-rescue-v1";

  async rescue(input: MacroRescueInput): Promise<MacroRescueResult> {
    const profile = await prisma.profile.findUniqueOrThrow({
      where: { id: input.profileId },
      include: { allergies: true },
    });

    const remaining = await getRemainingDailyTargets(input.profileId, input.now);
    const targets: MacroRescueTargets = {
      calories: input.targetsOverride?.calories ?? remaining.kcal,
      protein: input.targetsOverride?.protein ?? remaining.proteinG,
      carbs: input.targetsOverride?.carbs ?? remaining.carbsG,
      fat: input.targetsOverride?.fat ?? remaining.fatG,
      fiber: input.targetsOverride?.fiber,
    };

    const dbRecipes = await prisma.recipe.findMany({
      where: { OR: [{ isCustom: false }, { ownerProfileId: input.profileId }] },
    });
    // Ausgeschlossene Zutaten und Allergien laufen über die gemeinsame Food-Auflösung; ohne beides ist der Katalog unnötig.
    const excluded = input.excludedIngredients ?? [];
    const catalog = excluded.length > 0 || profile.allergies.length > 0 ? await loadFoodCatalog() : undefined;
    let candidates = dbRecipes.map(dbRecipeToSearchable);
    if (catalog) candidates = await attachStructuredIngredients(candidates);

    // Mahlzeit-Typ und Zeitlimit sind reine Relevanz-Vorfilter (z.B. "Snack"
    // soll kein Abendessen liefern), keine Hard Constraints im Sinne dieses
    // Kapitels und deshalb nicht Teil von rejectedCandidates/constraintsApplied.
    const slot = resolveMealSlot(input.mealType);
    if (slot) candidates = candidates.filter((r) => r.mealSlots.includes(slot));
    if (input.maxCookingTimeMin !== undefined) {
      candidates = candidates.filter((r) => r.prepTimeMin <= input.maxCookingTimeMin!);
    }

    const hardCtx: HardConstraintContext = {
      allergies: profile.allergies.map((a) => a.label),
      dietType: profile.dietType,
      excludedIngredients: excluded,
      catalog,
    };

    const tolerances: MacroTolerances = { ...DEFAULT_MACRO_TOLERANCES, ...input.tolerances };

    const { solutions, rejectedCandidates, constraintsApplied } = selectRescueSolutions(
      candidates,
      hardCtx,
      targets,
      tolerances,
      DEFAULT_MACRO_LOSS_WEIGHTS,
      input.limit ?? 3,
    );

    return { targets, tolerances, solutions, rejectedCandidates, constraintsApplied };
  }
}

let cached: MacroRescueEngine | null = null;

export function getMacroRescueEngine(): MacroRescueEngine {
  if (!cached) cached = new MacroRescueEngine();
  return cached;
}
