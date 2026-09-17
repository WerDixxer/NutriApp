import { getLLMProvider, type ToolDefinition } from "./llmProvider";
import { assistantExtractionSchema, type AssistantExtraction } from "./assistantQuery";

const EXTRACT_TOOL: ToolDefinition = {
  name: "extract_query",
  description:
    "Extrahiert Absicht (intent) und strukturierte Ernährungs-/Rezeptparameter (query) aus der Nutzernachricht. " +
    "Beantwortet die Nachricht nicht, füllt nur, was tatsächlich in der Nachricht (oder dem kurzen Verlauf davor) vorkommt.",
  inputSchema: {
    type: "object",
    properties: {
      intent: {
        type: "string",
        enum: [
          "ANSWER_QUESTION",
          "SEARCH_RECIPES",
          "DECIDE_MEAL",
          "TRANSFORM_RECIPE",
          "MACRO_RESCUE",
          "USE_PANTRY",
          "BUILD_MEAL_PLAN",
          "OTHER",
        ],
        description:
          "ANSWER_QUESTION = allgemeine Frage ohne Aktion. SEARCH_RECIPES = Rezeptideen nach Kriterien suchen. " +
          "DECIDE_MEAL = eine konkrete Mahlzeit auswählen lassen (auch 'entscheide für mich'). " +
          "TRANSFORM_RECIPE = ein zuvor genanntes Rezept verändern. MACRO_RESCUE = Rest-Tagesmakros auffüllen. " +
          "USE_PANTRY = Nutzer nennt vorhandene Zutaten, will die verwerten. BUILD_MEAL_PLAN = ganzen Essensplan erstellen. " +
          "OTHER = nichts davon oder kein Ernährungsbezug.",
      },
      query: {
        type: "object",
        properties: {
          calories: { type: "number", description: "Gewünschte/verbleibende Kalorien" },
          protein: { type: "number", description: "Gewünschtes/verbleibendes Protein in Gramm" },
          carbs: { type: "number", description: "Gewünschte/verbleibende Kohlenhydrate in Gramm" },
          fat: { type: "number", description: "Gewünschtes/verbleibendes Fett in Gramm" },
          fiber: { type: "number", description: "Gewünschte Ballaststoffe in Gramm" },
          ingredients: { type: "array", items: { type: "string" }, description: "Vorhandene/gewünschte Zutaten" },
          excludedIngredients: { type: "array", items: { type: "string" }, description: "Auszuschließende Zutaten" },
          allergies: { type: "array", items: { type: "string" } },
          dietaryStyle: { type: "string", description: "z.B. vegan, vegetarisch, keto" },
          cuisine: { type: "string", description: "z.B. italienisch, asiatisch" },
          mealType: { type: "string", description: "z.B. Frühstück, Mittag, Abend, Snack" },
          servings: { type: "number" },
          maxCookingTimeMin: { type: "number" },
          budgetEur: { type: "number" },
          pantryOnly: { type: "boolean", description: "Nur aus vorhandenen Zutaten, nichts Neues einkaufen" },
          mealPrep: { type: "boolean" },
          preferences: { type: "array", items: { type: "string" }, description: "z.B. schnell, günstig, high-protein" },
          decisionMode: { type: "boolean", description: "true bei 'entscheide einfach für mich' o.ä." },
          householdContext: { type: "string", description: "z.B. 'für die ganze Familie', 'nur für mich'" },
          recipeReference: { type: "string", description: "Bei TRANSFORM_RECIPE: welches Rezept gemeint ist" },
          instruction: { type: "string", description: "Bei TRANSFORM_RECIPE: die gewünschte Änderung" },
        },
      },
    },
    required: ["intent", "query"],
  },
};

const SYSTEM_PROMPT =
  "Du bist die Verstehens-Schicht eines Ernährungscoach-Chats. Deine einzige Aufgabe ist, aus der " +
  "letzten Nutzernachricht (im Kontext des kurzen Verlaufs) Absicht und strukturierte Parameter zu " +
  "extrahieren. Du beantwortest nichts, du erfindest keine Werte, die nicht in der Nachricht stehen. " +
  "Antworte ausschließlich über das Tool `extract_query`.";

const FALLBACK: AssistantExtraction = { intent: "OTHER", query: {} };

/**
 * Stufe 1 der Assistant-Pipeline: LLM -> strukturierter Tool-Aufruf -> zod-
 * Validierung. Die Domain-Logik (Stufe 2, siehe foodAssistant.ts) bekommt
 * damit nie ungeprüften LLM-Output, sondern ein typisiertes, validiertes
 * Objekt oder im Zweifel den sicheren Fallback `OTHER`.
 */
export async function extractAssistantQuery(
  userMessage: string,
  recentHistory: { role: "user" | "assistant"; content: string }[],
): Promise<AssistantExtraction> {
  const provider = getLLMProvider();

  const response = await provider.chat({
    system: SYSTEM_PROMPT,
    messages: [...recentHistory, { role: "user", content: userMessage }],
    tools: [EXTRACT_TOOL],
    toolChoice: { type: "tool", name: "extract_query" },
    maxTokens: 600,
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return FALLBACK;

  const parsed = assistantExtractionSchema.safeParse(toolUse.input);
  if (!parsed.success) return FALLBACK;

  return parsed.data;
}
