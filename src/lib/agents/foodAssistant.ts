import type { DietType, MealSlot } from "@prisma/client";
import { prisma } from "../db";
import { dbRecipeToDetail } from "../recipeDetail";
import type { RecipeDetail } from "@/components/RecipeDetailModal";
import { getLLMProvider, type ContentBlock, type LLMMessage, type TextBlock, type ToolDefinition } from "./llmProvider";
import { searchRecipes, type NutritionQuery, type SearchableRecipe } from "./recipeSearch";
import { decideForMe } from "./decideForMe";
import { macroRescue } from "./macroRescue";
import { transformRecipe } from "./recipeTransformer";

const SYSTEM_PROMPT = `Du bist der Ernährungscoach in einer persönlichen Ernährungs-App. Du hilfst \
dem Nutzer, ohne dass er selbst suchen oder rechnen muss.

Regeln:
- Erfinde NIEMALS Nährwerte oder Rezepte. Rezeptvorschläge kommen ausschließlich aus deinen \
Tools, die greifen auf die echte, geprüfte Rezeptdatenbank des Nutzers zu.
- Nutze search_recipes, wenn der Nutzer Zutaten, Zeit, Makro-Wünsche oder Rezeptideen nennt.
- Nutze decide_for_me, wenn der Nutzer sagt "entscheide für mich" o.ä. Es wählt automatisch \
eine konkrete, zeitlich passende Mahlzeit aus seinem heutigen Plan.
- Nutze macro_rescue bei Fragen wie "was passt noch in meine Makros" / "rette meine Makros".
- Nutze transform_recipe, wenn der Nutzer ein zuvor genanntes Rezept verändert haben möchte \
(proteinreicher, vegan, kleinere Portion, ...).
- Fasse Tool-Ergebnisse kurz zusammen. Die App zeigt die Rezeptkarten selbst an, wiederhole \
nicht jedes Detail in Textform.
- Antworte auf Deutsch, direkt und knapp, ohne Floskeln.
- Verwende niemals Gedankenstriche (—) in deinen Antworten. Nutze stattdessen Punkte, Kommas \
oder Doppelpunkte.
- Bei Themen ohne Bezug zu Ernährung/Rezepten: freundlich ablehnen und zurücklenken.`;

const TOOLS: ToolDefinition[] = [
  {
    name: "search_recipes",
    description:
      "Durchsucht die Rezeptdatenbank des Nutzers anhand strukturierter Kriterien (Kalorien-/Makro-Ziel, verfügbare/ausgeschlossene Zutaten, Diätform, max. Zubereitungszeit, Mahlzeit-Typ).",
    inputSchema: {
      type: "object",
      properties: {
        calorieTarget: { type: "number" },
        proteinTarget: { type: "number" },
        carbTarget: { type: "number" },
        fatTarget: { type: "number" },
        availableIngredients: { type: "array", items: { type: "string" } },
        excludedIngredients: { type: "array", items: { type: "string" } },
        dietaryPreferences: { type: "array", items: { type: "string" } },
        maxPreparationTimeMin: { type: "number" },
        mealType: { type: "string", description: "z.B. Frühstück, Mittag, Abend, Snack" },
      },
    },
  },
  {
    name: "decide_for_me",
    description:
      "Wählt automatisch EINE konkrete, zeitlich passende Mahlzeit aus dem heutigen Plan des Nutzers, die er noch nicht gegessen hat.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "macro_rescue",
    description:
      "Berechnet, wie viele Kalorien/Makros dem Nutzer heute noch zum Tagesziel fehlen, und schlägt passende Rezepte vor, um die Lücke zu schließen.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "transform_recipe",
    description:
      "Schreibt ein bestehendes Rezept anhand einer Anweisung um (proteinreicher, vegan, kleinere Portion, weniger Zutaten, ...).",
    inputSchema: {
      type: "object",
      properties: {
        recipeName: { type: "string", description: "Name des zuvor genannten oder vorgeschlagenen Rezepts" },
        instruction: { type: "string", description: "Die gewünschte Änderung, in eigenen Worten" },
      },
      required: ["recipeName", "instruction"],
    },
  },
];

type RecipeRow = Awaited<ReturnType<typeof prisma.recipe.findMany>>[number];

function toSearchable(r: RecipeRow): SearchableRecipe {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kcal: r.kcal,
    proteinG: r.proteinG,
    carbsG: r.carbsG,
    fatG: r.fatG,
    prepTimeMin: r.prepTimeMin,
    servings: r.servings,
    mealSlots: JSON.parse(r.mealSlots) as MealSlot[],
    dietTypes: JSON.parse(r.dietTypes) as DietType[],
    allergens: JSON.parse(r.allergens) as string[],
    ingredients: JSON.parse(r.ingredients) as string[],
    tags: JSON.parse(r.tags) as string[],
    isTrending: r.isTrending,
  };
}

interface ToolExecutionResult {
  resultText: string;
  recipes: RecipeDetail[];
}

async function runSearchRecipes(profileId: string, query: NutritionQuery): Promise<ToolExecutionResult> {
  const profile = await prisma.profile.findUniqueOrThrow({
    where: { id: profileId },
    include: { allergies: true, dislikedFoods: true },
  });
  const dbRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
  });
  const dbById = new Map(dbRecipes.map((r) => [r.id, r]));

  const merged: NutritionQuery = {
    ...query,
    allergies: [...(query.allergies ?? []), ...profile.allergies.map((a) => a.label)],
    excludedIngredients: [
      ...(query.excludedIngredients ?? []),
      ...profile.dislikedFoods.map((d) => d.label),
    ],
  };

  const matches = searchRecipes(merged, dbRecipes.map(toSearchable), 5);
  const recipes = matches.map((m) => dbRecipeToDetail(dbById.get(m.recipe.id)!));

  const resultText =
    recipes.length === 0
      ? "Keine passenden Rezepte gefunden."
      : `Gefunden: ${recipes.map((r) => `${r.name} (${r.kcal} kcal, ${r.proteinG}g Protein)`).join("; ")}.`;

  return { resultText, recipes };
}

async function runDecideForMe(profileId: string): Promise<ToolExecutionResult> {
  const decision = await decideForMe(profileId);
  if (!decision) {
    return { resultText: "Heute ist bereits alles aus dem Plan geloggt, nichts mehr zu entscheiden.", recipes: [] };
  }
  const dbRecipe = await prisma.recipe.findUniqueOrThrow({ where: { id: decision.recipeId } });
  const recipe = dbRecipeToDetail(dbRecipe, decision.portionMultiplier);
  return {
    resultText: `${decision.reason} Vorschlag: ${recipe.name} um ${decision.time} Uhr (${recipe.kcal} kcal, ${recipe.proteinG}g Protein).`,
    recipes: [recipe],
  };
}

async function runMacroRescue(profileId: string): Promise<ToolExecutionResult> {
  const result = await macroRescue(profileId);
  const dbRecipes = await prisma.recipe.findMany({
    where: { id: { in: result.options.map((o) => o.recipe.id) } },
  });
  const dbById = new Map(dbRecipes.map((r) => [r.id, r]));
  const recipes = result.options.map((o) =>
    dbRecipeToDetail(dbById.get(o.recipe.id)!, o.suggestedPortionMultiplier),
  );

  const r = result.remaining;
  const resultText = `Noch offen: ${Math.round(r.kcal)} kcal, ${Math.round(r.proteinG)}g Protein, ${Math.round(r.carbsG)}g Carbs, ${Math.round(r.fatG)}g Fett. ${
    recipes.length > 0
      ? `Vorschläge: ${recipes.map((rec) => rec.name).join(", ")}.`
      : "Keine passenden Rezepte in der Datenbank gefunden."
  }`;

  return { resultText, recipes };
}

async function runTransformRecipe(
  profileId: string,
  input: { recipeName: string; instruction: string },
): Promise<ToolExecutionResult> {
  const dbRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profileId }] },
  });
  const original = dbRecipes.find((r) => r.name.toLowerCase().includes(input.recipeName.toLowerCase()));
  if (!original) {
    return { resultText: `Rezept "${input.recipeName}" nicht gefunden.`, recipes: [] };
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
    input.instruction,
  );

  const dietTypes = new Set(JSON.parse(original.dietTypes) as string[]);
  const lower = input.instruction.toLowerCase();
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
  };
}

async function executeTool(profileId: string, name: string, input: unknown): Promise<ToolExecutionResult> {
  switch (name) {
    case "search_recipes":
      return runSearchRecipes(profileId, (input ?? {}) as NutritionQuery);
    case "decide_for_me":
      return runDecideForMe(profileId);
    case "macro_rescue":
      return runMacroRescue(profileId);
    case "transform_recipe":
      return runTransformRecipe(profileId, input as { recipeName: string; instruction: string });
    default:
      return { resultText: `Unbekanntes Tool "${name}".`, recipes: [] };
  }
}

export interface AssistantTurnResult {
  reply: string;
  recipes: RecipeDetail[];
}

const MAX_TOOL_ROUNDS = 4;
const HISTORY_LIMIT = 20;

/**
 * Führt eine Assistant-Runde aus: lädt Verlauf, ruft das LLM mit den
 * verfügbaren Tools auf, führt angeforderte Tools deterministisch gegen die
 * echte Datenbank aus und speichert Nutzer- + Antwort-Nachricht.
 */
export async function runFoodAssistant(profileId: string, userMessage: string): Promise<AssistantTurnResult> {
  const provider = getLLMProvider();

  const history = await prisma.assistantMessage.findMany({
    where: { profileId },
    orderBy: { createdAt: "asc" },
    take: HISTORY_LIMIT,
  });

  const messages: LLMMessage[] = history.map((m) => ({
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
  }));
  messages.push({ role: "user", content: userMessage });

  const suggestions = new Map<string, RecipeDetail>();
  const toolLog: { tool: string; input: unknown }[] = [];
  let finalText = "";

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await provider.chat({ system: SYSTEM_PROMPT, messages, tools: TOOLS });

    if (response.stopReason !== "tool_use") {
      finalText = response.content
        .filter((b): b is TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    messages.push({ role: "assistant", content: response.content });

    const resultBlocks: ContentBlock[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      toolLog.push({ tool: block.name, input: block.input });
      const { resultText, recipes } = await executeTool(profileId, block.name, block.input);
      for (const r of recipes) suggestions.set(r.id, r);
      resultBlocks.push({ type: "tool_result", toolUseId: block.id, content: resultText });
    }
    messages.push({ role: "user", content: resultBlocks });
  }

  if (!finalText) {
    finalText = "Ich konnte dazu gerade keine passende Antwort finden. Versuch es nochmal etwas anders formuliert.";
  }

  await prisma.assistantMessage.create({ data: { profileId, role: "USER", content: userMessage } });
  await prisma.assistantMessage.create({
    data: {
      profileId,
      role: "ASSISTANT",
      content: finalText,
      toolCalls: toolLog.length > 0 ? JSON.stringify(toolLog) : null,
    },
  });

  return { reply: finalText, recipes: Array.from(suggestions.values()) };
}
