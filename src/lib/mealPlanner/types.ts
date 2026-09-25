import type { DietType } from "@prisma/client";
import type { CalendarDate } from "../calendarDate";
import type { MacroTarget } from "../nutrition";
import type { SearchableRecipe } from "../agents/recipeSearch";
import type { HouseholdPantryContext } from "../rotation/rotationService";
import type { BudgetContext } from "../budget/budgetContext";
import type { FoodPreferenceContext } from "../recipes/foodPreferences";

/** Die drei Standard-Slots plus optionaler SNACK, siehe Kapitel-10-Auftrag Abschnitt 3. */
export const PLANNABLE_MEAL_SLOTS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK"] as const;
export type PlannableMealSlot = (typeof PLANNABLE_MEAL_SLOTS)[number];

export interface MemberPlanningContext {
  householdMemberId: string;
  profileId: string;
  name: string | null;
  dietType: DietType;
  allergies: string[];
  likedFoods: string[];
  dislikedFoods: string[];
  /** Volles Tagesziel (kein Log berücksichtigt), siehe nutrition.ts:calcFullTargets. */
  fullDailyTarget: MacroTarget;
  /** Tagesziel minus heute bereits Geloggtes, siehe agents/remainingTargets.ts. Nur für den heutigen Tag relevant. */
  remainingTodayTarget: MacroTarget;
}

export interface PlanningContext {
  householdId: string;
  members: MemberPlanningContext[];
  /** Zutaten aus explizit ausgeschlossenen Begriffen (z.B. "keine Pilze"), Plan-weit, nicht pro Mitglied. */
  excludedIngredients: string[];
  pantry: HouseholdPantryContext;
  budget: BudgetContext;
  candidates: SearchableRecipe[];
  /** Gemeinsame Food-Auflösung der Lieblinge/Abneigungen ALLER geplanten Mitglieder (recipes/foodPreferences.ts). Ohne sie gilt der Textabgleich. */
  foodPreferences?: FoodPreferenceContext;
  /** recipeId -> Anzahl Logs der geplanten Mitglieder in den letzten VARIETY_WINDOW_DAYS Tagen (siehe decision/softScoring.ts). */
  recentRecipeCounts: Map<string, number>;
}

export interface SlotTarget extends MacroTarget {
  slot: PlannableMealSlot;
}

export interface GeneratedMeal {
  /** Kalendertag der Mahlzeit (siehe src/lib/calendarDate.ts); wird erst beim Speichern zum DB-Wert. */
  date: CalendarDate;
  slot: PlannableMealSlot;
  recipeId: string;
  recipeName: string;
  portionMultiplier: number;
  /** Nur tatsächlich berechnete Gründe, siehe mealPlanner/softScoring.ts. */
  reasons: string[];
}

export type UnmetSlot = { date: CalendarDate; slot: PlannableMealSlot; reason: string };

export type MealPlanGenerationStatus = "SUCCESS" | "PARTIAL" | "NO_VALID_PLAN";

export interface GeneratedMealPlan {
  status: MealPlanGenerationStatus;
  meals: GeneratedMeal[];
  /** Slots, für die kein zulässiger Kandidat gefunden wurde (Grundlage für PARTIAL-Erklärungen, siehe Abschnitt 20/27). */
  unmetSlots: UnmetSlot[];
}
