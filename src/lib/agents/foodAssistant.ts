import { prisma } from "../db";
import { dbRecipeToDetail } from "../recipeDetail";
import type { RecipeDetail } from "@/components/RecipeDetailModal";
import { getLLMProvider, type LLMMessage } from "./llmProvider";
import { extractAssistantQuery } from "./queryExtraction";
import { assistantIntentSchema, type AssistantIntent, type AssistantQuery } from "./assistantQuery";
import { searchRecipes, type NutritionQuery } from "./recipeSearch";
import { dbRecipeToSearchable } from "./searchableRecipe";
import { getDecisionEngine } from "./decisionEngine";
import { getMacroRescueEngine } from "./macroRescueEngine";
import { transformRecipe } from "./recipeTransformer";
import { getOrGenerateDayPlan } from "../generateMealPlan";

/**
 * System-Prompt nur noch für die freie Text-Antwort (ANSWER_QUESTION/OTHER).
 * Strukturierte Aufgaben (Suche, Entscheidung, Transform, Rescue, Plan)
 * laufen über extractAssistantQuery() + deterministische Domain-Funktionen,
 * nicht mehr über ein vom LLM frei gewähltes Tool-Menü.
 */
const ANSWER_SYSTEM_PROMPT = `Du bist der Ernährungscoach in einer persönlichen Ernährungs-App. Du hilfst \
dem Nutzer, ohne dass er selbst suchen oder rechnen muss.

Regeln:
- Erfinde NIEMALS Nährwerte oder Rezepte. Du beantwortest hier nur eine allgemeine Frage, keine \
konkrete Rezept- oder Mahlzeitenempfehlung. Für Rezeptvorschläge verweist du darauf, dass der Nutzer \
danach fragen kann (z.B. "Was soll ich heute essen?"), das läuft über die echte Rezeptdatenbank.
- Antworte auf Deutsch, direkt und knapp, ohne Floskeln.
- Verwende niemals Gedankenstriche (—) in deinen Antworten. Nutze stattdessen Punkte, Kommas \
oder Doppelpunkte.
- Bei Themen ohne Bezug zu Ernährung/Rezepten: freundlich ablehnen und zurücklenken.`;

/** Bildet die Teilmenge von AssistantQuery ab, die recipeSearch.ts tatsächlich auswertet. */
export function toNutritionQuery(query: AssistantQuery, extra?: Partial<NutritionQuery>): NutritionQuery {
  return {
    calorieTarget: query.calories,
    proteinTarget: query.protein,
    carbTarget: query.carbs,
    fatTarget: query.fat,
    availableIngredients: query.ingredients,
    excludedIngredients: query.excludedIngredients,
    dietaryPreferences: [
      ...(query.dietaryStyle ? [query.dietaryStyle] : []),
      ...(query.preferences ?? []),
      ...(query.cuisine ? [query.cuisine] : []),
    ],
    allergies: query.allergies,
    maxPreparationTimeMin: query.maxCookingTimeMin,
    mealType: query.mealType,
    ...extra,
  };
}

export type AssistantActionType = "SHOW_RECIPES" | "SHOW_DECISION" | "SHOW_MEAL_PLAN" | "ASK_CLARIFICATION" | "NONE";

export interface AssistantAction {
  type: AssistantActionType;
}

interface TaskResult {
  resultText: string;
  recipes: RecipeDetail[];
  action: AssistantAction;
}

async function loadOwnAndSharedRecipes(profileId: string) {
  return prisma.recipe.findMany({ where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] } });
}

async function runSearchRecipesTask(profileId: string, query: AssistantQuery): Promise<TaskResult> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { allergies: true, dislikedFoods: true },
  });
  const dbRecipes = await loadOwnAndSharedRecipes(profileId);
  const dbById = new Map(dbRecipes.map((r) => [r.id, r]));

  const nutritionQuery = toNutritionQuery(query, {
    allergies: [...(query.allergies ?? []), ...profile.allergies.map((a) => a.label)],
    excludedIngredients: [...(query.excludedIngredients ?? []), ...profile.dislikedFoods.map((d) => d.label)],
  });

  const matches = searchRecipes(nutritionQuery, dbRecipes.map(dbRecipeToSearchable), 5);
  const recipes = matches.map((m) => dbRecipeToDetail(dbById.get(m.recipe.id)!));

  const resultText =
    recipes.length === 0
      ? "Keine passenden Rezepte gefunden. Magst du es mit anderen Kriterien nochmal versuchen?"
      : `Gefunden: ${recipes.map((r) => `${r.name} (${r.kcal} kcal, ${r.proteinG}g Protein)`).join("; ")}.`;

  return { resultText, recipes, action: { type: "SHOW_RECIPES" } };
}

async function runUsePantryTask(profileId: string, query: AssistantQuery): Promise<TaskResult> {
  if (!query.ingredients || query.ingredients.length === 0) {
    return {
      resultText: "Welche Zutaten hast du denn da? Nenn mir ein paar, dann schlage ich passende Rezepte vor.",
      recipes: [],
      action: { type: "ASK_CLARIFICATION" },
    };
  }
  const result = await runSearchRecipesTask(profileId, query);
  const prefix =
    result.recipes.length === 0
      ? ""
      : `Aus ${query.ingredients.join(", ")}${query.pantryOnly ? " (nur damit)" : ""} geht zum Beispiel: `;
  return { ...result, resultText: prefix ? `${prefix}${result.resultText.replace(/^Gefunden: /, "")}` : result.resultText };
}

async function runDecideMealTask(profileId: string, query: AssistantQuery): Promise<TaskResult> {
  const decision = await getDecisionEngine().decide({ profileId, query });
  if (!decision) {
    return {
      resultText:
        "Ich konnte keine Mahlzeit finden, die zu deinen Allergien, deiner Ernährungsform oder deinen Ausschlüssen passt. Magst du eine Einschränkung lockern?",
      recipes: [],
      action: { type: "NONE" },
    };
  }
  const dbRecipe = await prisma.recipe.findUniqueOrThrow({ where: { id: decision.recipeId } });
  const recipe = dbRecipeToDetail(dbRecipe, decision.portionMultiplier);
  const explanation = decision.reasons.length > 0 ? ` ${decision.reasons.join(" ")}` : "";
  return {
    resultText: `Meine Wahl: ${recipe.name} (${recipe.kcal} kcal, ${recipe.proteinG}g Protein).${explanation}`,
    recipes: [recipe],
    action: { type: "SHOW_DECISION" },
  };
}

async function runMacroRescueTask(profileId: string, query: AssistantQuery): Promise<TaskResult> {
  const result = await getMacroRescueEngine().rescue({
    profileId,
    excludedIngredients: query.excludedIngredients,
    mealType: query.mealType,
    maxCookingTimeMin: query.maxCookingTimeMin,
  });

  if (result.solutions.length === 0) {
    const t = result.targets;
    return {
      resultText: `Noch offen: ${Math.round(t.calories)} kcal, ${Math.round(t.protein)}g Protein, ${Math.round(t.carbs)}g Carbs, ${Math.round(t.fat)}g Fett. Keine passenden Rezepte in der Datenbank gefunden.`,
      recipes: [],
      action: { type: "NONE" },
    };
  }

  const dbRecipes = await prisma.recipe.findMany({ where: { id: { in: result.solutions.map((s) => s.recipeId) } } });
  const dbById = new Map(dbRecipes.map((r) => [r.id, r]));
  const recipes = result.solutions.map((s) => dbRecipeToDetail(dbById.get(s.recipeId)!, s.portionMultiplier));

  const best = result.solutions[0];
  const resultText = `${best.explanation}${result.solutions.length > 1 ? ` Alternativ: ${result.solutions.slice(1).map((s) => s.recipeName).join(", ")}.` : ""}`;

  return { resultText, recipes, action: { type: "SHOW_RECIPES" } };
}

async function runTransformRecipeTask(profileId: string, query: AssistantQuery): Promise<TaskResult> {
  if (!query.recipeReference) {
    return {
      resultText: "Welches Rezept soll ich verändern? Nenn mir den Namen.",
      recipes: [],
      action: { type: "ASK_CLARIFICATION" },
    };
  }
  if (!query.instruction) {
    return {
      resultText: `Was soll sich an "${query.recipeReference}" ändern (z.B. proteinreicher, vegan, kleinere Portion)?`,
      recipes: [],
      action: { type: "ASK_CLARIFICATION" },
    };
  }

  const dbRecipes = await loadOwnAndSharedRecipes(profileId);
  const original = dbRecipes.find((r) => r.name.toLowerCase().includes(query.recipeReference!.toLowerCase()));
  if (!original) {
    return { resultText: `Rezept "${query.recipeReference}" nicht gefunden.`, recipes: [], action: { type: "NONE" } };
  }

  const transformed = await transformRecipe(
    {
      name: original.name,
      description: original.description,
      kcal: original.kcal,
      proteinG: original.proteinG,
      carbsG: original.carbsG,
      fatG: original.fatG,
      ingredients: JSON.parse(original.ingredients) as string[],
      instructions: JSON.parse(original.instructions) as string[],
    },
    query.instruction,
  );

  const dietTypes = new Set(JSON.parse(original.dietTypes) as string[]);
  const lower = query.instruction.toLowerCase();
  if (lower.includes("vegan")) dietTypes.add("VEGAN");
  if (lower.includes("vegetarisch")) dietTypes.add("VEGETARIAN");
  if (lower.includes("halal")) dietTypes.add("HALAL");
  if (lower.includes("koscher") || lower.includes("kosher")) dietTypes.add("KOSHER");

  const saved = await prisma.recipe.create({
    data: {
      name: transformed.name,
      description: transformed.description,
      kcal: transformed.kcal,
      proteinG: transformed.proteinG,
      carbsG: transformed.carbsG,
      fatG: transformed.fatG,
      prepTimeMin: original.prepTimeMin,
      servings: original.servings,
      mealSlots: original.mealSlots,
      dietTypes: JSON.stringify(Array.from(dietTypes)),
      allergens: original.allergens,
      ingredients: JSON.stringify(transformed.ingredients),
      instructions: JSON.stringify(transformed.instructions),
      tags: JSON.stringify([...(JSON.parse(original.tags) as string[]), "ki-angepasst"]),
      isCustom: true,
      ownerProfileId: profileId,
      nutritionSource: transformed.nutritionSource,
      generatedByAssistant: true,
    },
  });

  const recipe = dbRecipeToDetail(saved);
  const note =
    transformed.nutritionSource === "AI_ESTIMATE"
      ? " Nährwerte sind eine KI-Schätzung (nicht exakt geprüft), Allergen-Angaben wurden unverändert vom Original übernommen und nicht neu geprüft."
      : "";
  return {
    resultText: `Neues Rezept gespeichert: ${recipe.name} (${recipe.kcal} kcal, ${recipe.proteinG}g Protein).${note}`,
    recipes: [recipe],
    action: { type: "SHOW_RECIPES" },
  };
}

async function runBuildMealPlanTask(profileId: string): Promise<TaskResult> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const plan = await getOrGenerateDayPlan(profileId, today);

  if (plan.items.length === 0) {
    return {
      resultText: "Ich konnte noch keinen Plan für heute erstellen, das passende Rezept fehlt vermutlich in deiner Datenbank.",
      recipes: [],
      action: { type: "NONE" },
    };
  }

  const recipes = plan.items.map((item) => dbRecipeToDetail(item.recipe, item.portionMultiplier));
  const totalKcal = Math.round(plan.items.reduce((sum, item) => sum + item.recipe.kcal * item.portionMultiplier, 0));
  const resultText = `Dein Plan für heute: ${recipes.map((r) => r.name).join(", ")} (zusammen ~${totalKcal} kcal).`;

  return { resultText, recipes, action: { type: "SHOW_MEAL_PLAN" } };
}

async function answerFreely(userMessage: string, history: LLMMessage[]): Promise<string> {
  const provider = getLLMProvider();
  const response = await provider.chat({
    system: ANSWER_SYSTEM_PROMPT,
    messages: [...history, { role: "user", content: userMessage }],
    maxTokens: 500,
  });
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("\n")
    .trim();
  return text || "Dazu fällt mir gerade nichts Passendes ein. Frag mich gern etwas anders.";
}

async function dispatch(profileId: string, intent: AssistantIntent, query: AssistantQuery, userMessage: string, history: LLMMessage[]): Promise<TaskResult> {
  switch (intent) {
    case "SEARCH_RECIPES":
      return runSearchRecipesTask(profileId, query);
    case "USE_PANTRY":
      return runUsePantryTask(profileId, query);
    case "DECIDE_MEAL":
      return runDecideMealTask(profileId, query);
    case "MACRO_RESCUE":
      return runMacroRescueTask(profileId, query);
    case "TRANSFORM_RECIPE":
      return runTransformRecipeTask(profileId, query);
    case "BUILD_MEAL_PLAN":
      return runBuildMealPlanTask(profileId);
    case "ANSWER_QUESTION":
    case "OTHER":
    default:
      return { resultText: await answerFreely(userMessage, history), recipes: [], action: { type: "NONE" } };
  }
}

export interface AssistantTurnResult {
  reply: string;
  intent: AssistantIntent;
  recipes: RecipeDetail[];
  action: AssistantAction;
}

const HISTORY_LIMIT = 20;
const EXTRACTION_HISTORY_LIMIT = 6;

/**
 * Zweistufige Assistant-Pipeline:
 * 1. extractAssistantQuery(): LLM -> erzwungener Tool-Aufruf -> zod-validiert -> {intent, query}.
 * 2. dispatch(): rein deterministisch (kein weiterer LLM-Aufruf außer bei
 *    TRANSFORM_RECIPE intern und bei ANSWER_QUESTION/OTHER), ruft die echte
 *    Domain-Logik (Rezeptsuche, Decision Engine, Macro Rescue, Meal Plan).
 * So bekommt die Domain-Logik nie ungeprüften LLM-Output, und es passieren
 * nie mehr LLM-Aufrufe als nötig.
 */
export async function runFoodAssistant(profileId: string, userMessage: string): Promise<AssistantTurnResult> {
  const history = await prisma.assistantMessage.findMany({
    where: { profileId },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const chronological = history.slice().reverse();

  const llmHistory: LLMMessage[] = chronological.map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
  }));

  const extractionHistory = chronological.slice(-EXTRACTION_HISTORY_LIMIT).map((m) => ({
    role: (m.role === "USER" ? "user" : "assistant") as "user" | "assistant",
    content: m.content,
  }));

  const extraction = await extractAssistantQuery(userMessage, extractionHistory);
  const intent = assistantIntentSchema.safeParse(extraction.intent).success ? extraction.intent : "OTHER";

  const { resultText, recipes, action } = await dispatch(profileId, intent, extraction.query, userMessage, llmHistory);

  await prisma.assistantMessage.create({ data: { profileId, role: "USER", content: userMessage } });
  await prisma.assistantMessage.create({
    data: {
      profileId,
      role: "ASSISTANT",
      content: resultText,
      toolCalls: JSON.stringify({ intent, query: extraction.query }),
    },
  });

  return { reply: resultText, intent, recipes, action };
}
