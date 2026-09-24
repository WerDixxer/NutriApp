import type {
  ExactDuplicateGroup,
  PossibleDuplicatePair,
  QualityRecipeInput,
  RecipeCatalogQualityReport,
  RecipeQualityIssue,
  RecipeRef,
} from "./catalogQuality";

/**
 * Interne Review-Queue für den Rezeptkatalog (Kapitel 19). Baut AUSSCHLIESSLICH auf dem
 * bestehenden `RecipeCatalogQualityReport` aus Kapitel 18 auf - kein zweiter Duplicate
 * Detector, kein zweiter Quality-Scan, kein zweiter DB-Zugriff. `recipes` ist dieselbe Liste,
 * die den Report bereits gespeist hat; sie wird hier nur gebraucht, um "saubere" Rezepte zu
 * finden, die im Report selbst nirgends auftauchen, weil sie nichts zu melden haben.
 *
 * Der Status (`ReviewStatus`) ist bewusst reiner UI-Zustand: `buildRecipeReviewQueue` setzt ihn
 * immer auf "pending" und persistiert nichts. Eine echte Review-Historie ist Aufgabe eines
 * späteren Import-Kapitels (siehe Auftrag Abschnitt 5/11/23).
 */

export const REVIEW_STATUSES = ["pending", "needs_changes", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Technische, nicht-inhaltliche Einordnung eines Rezepts für die Queue-Reihenfolge (Auftrag
 * Abschnitt 3: "keine politische/inhaltliche Bewertung"). Priorität von oben nach unten:
 * exaktes Duplikat (sicherster Befund) vor möglichem Duplikat vor unzureichenden Daten
 * (blockiert jede verlässliche Prüfung) vor sonstigen Quality Issues vor sauber.
 */
export type ReviewCategory = "duplicate_exact" | "duplicate_possible" | "insufficient_data" | "quality_issue" | "clean";

const CATEGORY_ORDER: readonly ReviewCategory[] = ["duplicate_exact", "duplicate_possible", "insufficient_data", "quality_issue", "clean"];
const SEVERITY_RANK: Record<RecipeQualityIssue["severity"], number> = { error: 0, warning: 1, info: 2 };

export interface ReviewDuplicateCandidate {
  kind: "exact" | "possible";
  recipe: RecipeRef;
  /** 1 bei exakten Duplikaten (identische Struktur); sonst der Kapitel-18-Similarity-Score. */
  score: number;
  /** null bei exakten Duplikaten (Konzept "Überlappung" ist dort trivial 1 - alles ist identisch). */
  ingredientOverlap: number | null;
  nameOverlap: number | null;
  dietClassDiffers: boolean;
  /** Lesbare gemeinsame Merkmale: bei exakt die volle Zutatenliste, bei möglich die gemeinsamen Food-Namen. */
  sharedFeatures: string[];
}

export interface RecipeReviewItem {
  recipeId: string;
  recipeName: string;
  slug: string | null;
  /** Reiner UI-Ausgangszustand; siehe Moduldoku. Immer "pending". */
  status: ReviewStatus;
  category: ReviewCategory;
  /** Kurzer, nachvollziehbarer Grund für die Kategorie (kein Werturteil, nur Befund). */
  reviewReason: string;
  qualityIssues: RecipeQualityIssue[];
  duplicateCandidates: ReviewDuplicateCandidate[];
  /** Grund aus `insufficientData` (Kapitel 18), falls das Rezept dort geführt wird. */
  insufficientDataReason: string | null;
}

export interface RecipeReviewQueue {
  items: RecipeReviewItem[];
  summary: { total: number; byCategory: Record<ReviewCategory, number> };
}

/**
 * Exportiert (Kapitel 20): `recipeImport.ts` baut Review-Items für Import-Kandidaten aus
 * denselben Bausteinen wie diese Queue, statt eine zweite Item-Konstruktion nachzubauen.
 */
export function exactCandidatesFor(recipeId: string, groups: readonly ExactDuplicateGroup[]): ReviewDuplicateCandidate[] {
  const candidates: ReviewDuplicateCandidate[] = [];
  for (const group of groups) {
    if (!group.recipes.some((r) => r.id === recipeId)) continue;
    for (const other of group.recipes) {
      if (other.id === recipeId) continue;
      candidates.push({
        kind: "exact",
        recipe: other,
        score: 1,
        ingredientOverlap: null,
        nameOverlap: null,
        dietClassDiffers: false,
        sharedFeatures: group.sharedFeatures,
      });
    }
  }
  return candidates;
}

export function possibleCandidatesFor(recipeId: string, pairs: readonly PossibleDuplicatePair[]): ReviewDuplicateCandidate[] {
  const candidates: ReviewDuplicateCandidate[] = [];
  for (const pair of pairs) {
    const other = pair.recipeA.id === recipeId ? pair.recipeB : pair.recipeB.id === recipeId ? pair.recipeA : null;
    if (!other) continue;
    candidates.push({
      kind: "possible",
      recipe: other,
      score: pair.score,
      ingredientOverlap: pair.ingredientOverlap,
      nameOverlap: pair.nameOverlap,
      dietClassDiffers: pair.dietClassDiffers,
      sharedFeatures: pair.sharedFoodNames,
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export function reviewReasonFor(
  category: ReviewCategory,
  duplicateCandidates: ReviewDuplicateCandidate[],
  qualityIssues: RecipeQualityIssue[],
  insufficientDataReason: string | null,
): string {
  switch (category) {
    case "duplicate_exact": {
      const names = duplicateCandidates.filter((c) => c.kind === "exact").map((c) => c.recipe.name);
      return `Exaktes strukturelles Duplikat von: ${names.join(", ")}.`;
    }
    case "duplicate_possible": {
      const top = duplicateCandidates.find((c) => c.kind === "possible");
      return top ? `Möglicher Duplicate-Kandidat: "${top.recipe.name}" (Similarity ${top.score.toFixed(2)}).` : "Möglicher Duplicate-Kandidat.";
    }
    case "insufficient_data":
      return insufficientDataReason ?? "Unzureichende strukturierte Daten für eine automatische Prüfung.";
    case "quality_issue": {
      const worst = [...qualityIssues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
      return worst?.message ?? "Quality Issue.";
    }
    case "clean":
      return "Keine Quality Issues oder Duplicate-Kandidaten gefunden.";
  }
}

/**
 * Baut die Review-Queue. `recipes` muss dieselbe Liste sein, die `report` erzeugt hat (ein
 * `loadCatalogQualityInputs()`-Aufruf reicht für Report UND Queue, siehe Performance-Vorgabe
 * Abschnitt 16). Rein lesend/rechnend, keine Datenbank, keine Mutation.
 */
export function buildRecipeReviewQueue(recipes: readonly QualityRecipeInput[], report: RecipeCatalogQualityReport): RecipeReviewQueue {
  const qualityByRecipe = new Map<string, RecipeQualityIssue[]>();
  for (const issue of report.qualityIssues) {
    const list = qualityByRecipe.get(issue.recipeId) ?? [];
    list.push(issue);
    qualityByRecipe.set(issue.recipeId, list);
  }
  const insufficientByRecipe = new Map(report.insufficientData.map((e) => [e.recipeId, e.reason]));

  const items: RecipeReviewItem[] = recipes.map((recipe) => {
    const exact = exactCandidatesFor(recipe.id, report.exactDuplicates);
    const possible = possibleCandidatesFor(recipe.id, report.possibleDuplicates);
    const qualityIssues = qualityByRecipe.get(recipe.id) ?? [];
    const insufficientDataReason = insufficientByRecipe.get(recipe.id) ?? null;
    const duplicateCandidates = [...exact, ...possible];

    const category: ReviewCategory =
      exact.length > 0
        ? "duplicate_exact"
        : possible.length > 0
          ? "duplicate_possible"
          : insufficientDataReason !== null
            ? "insufficient_data"
            : qualityIssues.length > 0
              ? "quality_issue"
              : "clean";

    return {
      recipeId: recipe.id,
      recipeName: recipe.name,
      slug: recipe.slug,
      status: "pending",
      category,
      reviewReason: reviewReasonFor(category, duplicateCandidates, qualityIssues, insufficientDataReason),
      qualityIssues,
      duplicateCandidates,
      insufficientDataReason,
    };
  });

  items.sort((a, b) => {
    const categoryDiff = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (categoryDiff !== 0) return categoryDiff;
    if (a.category === "duplicate_possible") {
      const scoreDiff = (b.duplicateCandidates[0]?.score ?? 0) - (a.duplicateCandidates[0]?.score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
    }
    return a.recipeName.localeCompare(b.recipeName, "de");
  });

  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<ReviewCategory, number>;
  for (const item of items) byCategory[item.category]++;

  return { items, summary: { total: items.length, byCategory } };
}
