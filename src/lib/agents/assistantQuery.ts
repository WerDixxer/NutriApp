import { z } from "zod";

/**
 * Die Aufgaben, zwischen denen der Food Assistant unterscheidet (Master-
 * Prompt Kapitel 3, Punkt 4). `intent` steuert im Assistant-Orchestrator
 * deterministisch, welche Domain-Funktion aufgerufen wird, das LLM trifft
 * hier nur die Klassifikation, nie die eigentliche Entscheidung.
 */
export const assistantIntentSchema = z.enum([
  /** Allgemeine Frage ohne konkrete Aktion, z.B. Erklärung, Small Talk zu Ernährung. */
  "ANSWER_QUESTION",
  /** Rezeptideen anhand von Kriterien suchen. */
  "SEARCH_RECIPES",
  /** Eine konkrete Mahlzeit auswählen ("entscheide für mich", "was soll ich jetzt essen"). */
  "DECIDE_MEAL",
  /** Ein zuvor genanntes/vorgeschlagenes Rezept verändern. */
  "TRANSFORM_RECIPE",
  /** Verbleibende Tagesmakros mit passenden Rezepten auffüllen. */
  "MACRO_RESCUE",
  /** Nutzer nennt Zutaten, die er gerade zuhause hat, und will das verwerten. */
  "USE_PANTRY",
  /** Nutzer will einen (Tages-)Essensplan erstellt bekommen. */
  "BUILD_MEAL_PLAN",
  /** Nichts davon eindeutig, oder Thema ohne Ernährungsbezug. */
  "OTHER",
]);
export type AssistantIntent = z.infer<typeof assistantIntentSchema>;

const stringListField = z.array(z.string().trim().min(1).max(60)).max(20).optional();

/**
 * Strukturierte Parameter, aus natürlicher Sprache extrahiert. Alle Felder
 * optional, das LLM füllt nur, was in der Nachricht tatsächlich vorkommt.
 * Nicht jedes Feld wird heute schon von Domain-Logik ausgewertet (siehe
 * Kommentare), sie werden aber bereits erfasst, damit spätere Kapitel
 * (Pantry, Budget, Household, Meal Prep) die Extraktion nicht anfassen
 * müssen, nur die Auswertung ergänzen.
 */
export const assistantQuerySchema = z.object({
  calories: z.number().min(0).max(10000).optional(),
  protein: z.number().min(0).max(1000).optional(),
  carbs: z.number().min(0).max(2000).optional(),
  fat: z.number().min(0).max(1000).optional(),
  /** Noch nicht auswertbar: Recipe-Modell hat aktuell kein Fiber-Feld (siehe Chapter-0-Analyse). */
  fiber: z.number().min(0).max(200).optional(),
  ingredients: stringListField,
  excludedIngredients: stringListField,
  allergies: stringListField,
  dietaryStyle: z.string().trim().max(60).optional(),
  /** Noch nicht auswertbar: recipeSearch kennt keinen harten Cuisine-Filter, nur weiches Tag-Matching. */
  cuisine: z.string().trim().max(60).optional(),
  mealType: z.string().trim().max(60).optional(),
  /** Noch nicht auswertbar: Rezepte haben `servings`, aber kein Query-Feld skaliert danach. */
  servings: z.number().int().min(1).max(20).optional(),
  maxCookingTimeMin: z.number().int().min(1).max(600).optional(),
  /** Noch nicht auswertbar: kein Preis-/Budget-Datenmodell vor Kapitel 8. */
  budgetEur: z.number().min(0).max(1000).optional(),
  /** Noch nicht auswertbar: kein persistentes Pantry-Modell vor Kapitel 6, siehe USE_PANTRY-Dispatch. */
  pantryOnly: z.boolean().optional(),
  /** Noch nicht auswertbar vor Kapitel 11 (Meal Prep Optimizer). */
  mealPrep: z.boolean().optional(),
  preferences: stringListField,
  /** true bei "entscheide einfach für mich" o.ä., steuert DECIDE_MEAL-Dispatch an die Decision Engine. */
  decisionMode: z.boolean().optional(),
  /** Noch nicht auswertbar: kein Household-Kontext in der aktuellen Domain-Logik vor Kapitel 9. */
  householdContext: z.string().trim().max(120).optional(),
  /** Für TRANSFORM_RECIPE: welches Rezept gemeint ist (Name/Referenz aus dem Gespräch). */
  recipeReference: z.string().trim().max(120).optional(),
  /** Für TRANSFORM_RECIPE: die gewünschte Änderung in eigenen Worten. */
  instruction: z.string().trim().max(300).optional(),
});
export type AssistantQuery = z.infer<typeof assistantQuerySchema>;

export const assistantExtractionSchema = z.object({
  intent: assistantIntentSchema,
  query: assistantQuerySchema,
});
export type AssistantExtraction = z.infer<typeof assistantExtractionSchema>;
