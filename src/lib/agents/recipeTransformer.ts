import { getLLMProvider } from "./llmProvider";

export interface TransformableRecipe {
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];
  instructions: string[];
}

export interface TransformResult {
  name: string;
  description: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];
  instructions: string[];
  /** DATABASE = deterministisch aus dem Originalrezept skaliert, AI_ESTIMATE = von der KI geschätzt. */
  nutritionSource: "DATABASE" | "AI_ESTIMATE";
}

const RESIZE_PATTERN =
  /(größere?|kleinere?|doppelte|halbe)\s+portion|(\d+)\s*(kcal|kalorien)/i;

/** Reine Größenänderungen behalten das Makroverhältnis exakt bei, keine KI nötig. */
function tryDeterministicResize(
  recipe: TransformableRecipe,
  instruction: string,
): TransformResult | null {
  const match = instruction.match(RESIZE_PATTERN);
  if (!match) return null;

  let scale = 1;
  if (/doppelte/i.test(instruction)) scale = 2;
  else if (/halbe/i.test(instruction)) scale = 0.5;
  else if (/kleinere?/i.test(instruction)) scale = 0.75;
  else if (/größere?/i.test(instruction)) scale = 1.3;
  else {
    const kcalMatch = instruction.match(/(\d+)\s*(kcal|kalorien)/i);
    if (kcalMatch) scale = Number(kcalMatch[1]) / Math.max(recipe.kcal, 1);
  }
  scale = Math.min(Math.max(scale, 0.3), 3);

  return {
    name: recipe.name,
    description: recipe.description,
    kcal: Math.round(recipe.kcal * scale),
    proteinG: Math.round(recipe.proteinG * scale * 10) / 10,
    carbsG: Math.round(recipe.carbsG * scale * 10) / 10,
    fatG: Math.round(recipe.fatG * scale * 10) / 10,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions,
    nutritionSource: "DATABASE",
  };
}

const SUBMIT_TOOL = {
  name: "submit_transformed_recipe",
  description: "Gibt das umgeschriebene Rezept strukturiert zurück.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      ingredients: { type: "array", items: { type: "string" }, description: "Je Zutat mit Menge, z.B. '200 g Tofu'" },
      instructions: { type: "array", items: { type: "string" }, description: "Je Zubereitungsschritt ein Eintrag" },
      kcal: { type: "number" },
      proteinG: { type: "number" },
      carbsG: { type: "number" },
      fatG: { type: "number" },
    },
    required: ["name", "description", "ingredients", "instructions", "kcal", "proteinG", "carbsG", "fatG"],
  },
} as const;

function isValidToolInput(input: unknown): input is {
  name: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
} {
  if (typeof input !== "object" || input === null) return false;
  const o = input as Record<string, unknown>;
  return (
    typeof o.name === "string" &&
    typeof o.description === "string" &&
    Array.isArray(o.ingredients) &&
    Array.isArray(o.instructions) &&
    typeof o.kcal === "number" &&
    typeof o.proteinG === "number" &&
    typeof o.carbsG === "number" &&
    typeof o.fatG === "number"
  );
}

/**
 * Schreibt ein Rezept anhand einer Anweisung um (proteinreicher, vegan,
 * weniger Zutaten, ...). Reine Größenänderungen werden deterministisch
 * skaliert (Makroverhältnis bleibt exakt erhalten, keine KI nötig). Für
 * echte Zutaten-/Zubereitungsänderungen schreibt die KI ein neues Rezept,
 * die resultierenden Nährwerte werden dann klar als `AI_ESTIMATE`
 * gekennzeichnet, nicht als verifizierter Wert behandelt (Nutrition-Engine-
 * Prinzip: nie stillschweigend KI-Schätzungen als Fakten ausgeben).
 */
export async function transformRecipe(
  recipe: TransformableRecipe,
  instruction: string,
): Promise<TransformResult> {
  const deterministic = tryDeterministicResize(recipe, instruction);
  if (deterministic) return deterministic;

  const provider = getLLMProvider();
  const response = await provider.chat({
    system:
      "Du bist ein Ernährungs-Rezeptredakteur. Du bekommst ein bestehendes Rezept und eine " +
      "Änderungsanweisung. Schreibe Zutaten (mit Mengenangaben, z.B. '200 g Hähnchenbrust') und " +
      "Zubereitungsschritte neu und schätze die resultierenden Nährwerte (kcal, Protein, Carbs, " +
      "Fett) für die gesamte angegebene Zutatenliste realistisch. Antworte ausschließlich über " +
      "das Tool `submit_transformed_recipe`.",
    messages: [
      {
        role: "user",
        content:
          `Original-Rezept: ${recipe.name}\n${recipe.description}\n` +
          `Zutaten: ${recipe.ingredients.join(", ")}\n` +
          `Zubereitung: ${recipe.instructions.join(" ")}\n` +
          `Nährwerte bisher: ${recipe.kcal} kcal, ${recipe.proteinG}g Protein, ${recipe.carbsG}g Carbs, ${recipe.fatG}g Fett\n\n` +
          `Änderungswunsch: ${instruction}`,
      },
    ],
    tools: [SUBMIT_TOOL],
    maxTokens: 1500,
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use" || !isValidToolInput(toolUse.input)) {
    throw new Error("Die KI hat kein gültiges umgeschriebenes Rezept zurückgegeben.");
  }

  const result = toolUse.input;
  return {
    name: result.name,
    description: result.description,
    ingredients: result.ingredients,
    instructions: result.instructions,
    kcal: Math.round(result.kcal),
    proteinG: Math.round(result.proteinG * 10) / 10,
    carbsG: Math.round(result.carbsG * 10) / 10,
    fatG: Math.round(result.fatG * 10) / 10,
    nutritionSource: "AI_ESTIMATE",
  };
}
