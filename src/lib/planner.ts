import type { MealSlot, SportType } from "@prisma/client";
import type { MacroTarget } from "./nutrition";
import { macroProfile } from "./foodMatching";

export interface TrainingSessionInput {
  startTime: string; // "HH:mm"
  durationMin: number;
  sportType: SportType;
}

export interface SlotTarget extends MacroTarget {
  slot: MealSlot;
  time: string;
}

// Interne Schlüssel für die 5 Standard-Slots (zwei davon sind beide "SNACK" im
// MealSlot-Enum, aber zu unterschiedlichen Uhrzeiten mit eigenem Makro-Budget).
type MainSlotKey = "BREAKFAST" | "SNACK_AM" | "LUNCH" | "SNACK_PM" | "DINNER";

const MAIN_SLOT_KEYS: MainSlotKey[] = ["BREAKFAST", "SNACK_AM", "LUNCH", "SNACK_PM", "DINNER"];

const MAIN_SLOT_ENUM: Record<MainSlotKey, MealSlot> = {
  BREAKFAST: "BREAKFAST",
  SNACK_AM: "SNACK",
  LUNCH: "LUNCH",
  SNACK_PM: "SNACK",
  DINNER: "DINNER",
};

const MAIN_SLOT_TIMES: Record<MainSlotKey, string> = {
  BREAKFAST: "08:00",
  SNACK_AM: "10:30",
  LUNCH: "13:00",
  SNACK_PM: "16:00",
  DINNER: "19:30",
};

// Anteile an kcal/Protein/Carbs/Fett je Slot (Summe je Spalte = 1). Fett bewusst
// Richtung Abend verschoben, Snacks bewusst fettarm ("Fette lieber am Abend").
const BASE_WEIGHTS: Record<MainSlotKey, MacroTarget> = {
  BREAKFAST: { kcal: 0.22, proteinG: 0.2, carbsG: 0.22, fatG: 0.24 },
  SNACK_AM: { kcal: 0.1, proteinG: 0.1, carbsG: 0.12, fatG: 0.06 },
  LUNCH: { kcal: 0.27, proteinG: 0.28, carbsG: 0.27, fatG: 0.28 },
  SNACK_PM: { kcal: 0.1, proteinG: 0.12, carbsG: 0.11, fatG: 0.06 },
  DINNER: { kcal: 0.31, proteinG: 0.3, carbsG: 0.28, fatG: 0.36 },
};

// Fixe Budgetanteile für Workout-Slots (werden von den Hauptmahlzeiten abgezogen).
const PRE_WORKOUT_WEIGHTS: MacroTarget = { kcal: 0.1, proteinG: 0.08, carbsG: 0.16, fatG: 0.03 };
const POST_WORKOUT_WEIGHTS: MacroTarget = { kcal: 0.13, proteinG: 0.18, carbsG: 0.14, fatG: 0.04 };

// Zusätzlicher Puffer um das Pre-/Post-Workout-Fenster, innerhalb dessen eine
// Hauptmahlzeit entfällt: das Workout-Meal übernimmt ihre Funktion, statt
// zusätzlich kurz vor oder während des Trainings noch eine Mahlzeit einzuschieben.
const ABSORB_BUFFER_MIN = 30;

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function addMinutes(time: string, minutes: number): string {
  const total = ((toMinutes(time) + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const mm = (total % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Liegt `time` innerhalb [from, to] (+ Puffer in beide Richtungen)? */
function isWithinWindow(time: string, from: string, to: string, bufferMin: number): boolean {
  const t = toMinutes(time);
  const start = toMinutes(from) - bufferMin;
  const end = toMinutes(to) + bufferMin;
  return t >= start && t <= end;
}

const MACRO_KEYS = ["kcal", "proteinG", "carbsG", "fatG"] as const;

/**
 * Verteilt die Tagesziele auf 5 Mahlzeiten-Slots (Frühstück, 2 Snacks, Mittag-,
 * Abendessen) plus Uhrzeiten. Mehr, kleinere Mahlzeiten machen es leichter, am
 * Ende alle Makros gleichzeitig zu treffen (siehe computeJointPortionScales).
 * Berücksichtigt die Trainingszeit für Pre-/Post-Workout-Meals (Carb-Fokus vor,
 * Protein-Fokus nach dem Training, jeweils fettarm für bessere Verdauung).
 * Eine Mahlzeit, die zeitlich zu nah am Training liegt, entfällt zugunsten
 * des Workout-Meals, statt eine schwere Mahlzeit kurz vor dem Sport einzuschieben.
 */
export function buildDayPlan(
  dailyTargets: MacroTarget,
  training?: TrainingSessionInput,
): SlotTarget[] {
  let preTime: string | null = null;
  let postTime: string | null = null;
  let absorbed: Set<MainSlotKey> = new Set();

  if (training) {
    preTime = addMinutes(training.startTime, -150);
    postTime = addMinutes(training.startTime, training.durationMin + 30);
    absorbed = new Set(
      MAIN_SLOT_KEYS.filter((key) =>
        isWithinWindow(MAIN_SLOT_TIMES[key], preTime!, postTime!, ABSORB_BUFFER_MIN),
      ),
    );
    // Sicherheitsnetz: nie alle Hauptmahlzeiten auf einmal verschlucken.
    if (absorbed.size === MAIN_SLOT_KEYS.length) absorbed.clear();
  }

  const activeKeys = MAIN_SLOT_KEYS.filter((k) => !absorbed.has(k));

  // Restbudget je Makro, das den aktiven Slots zusteht (nach Abzug der
  // Workout-Slot-Anteile), proportional zu ihren ursprünglichen Basisgewichten verteilt.
  const activeWeights: Record<string, MacroTarget> = {};
  for (const key of MACRO_KEYS) {
    const carved = training ? PRE_WORKOUT_WEIGHTS[key] + POST_WORKOUT_WEIGHTS[key] : 0;
    const remaining = Math.max(1 - carved, 0);
    const activeBaseTotal = activeKeys.reduce((sum, k) => sum + BASE_WEIGHTS[k][key], 0) || 1;
    for (const k of activeKeys) {
      activeWeights[k] ??= { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
      activeWeights[k][key] = (BASE_WEIGHTS[k][key] / activeBaseTotal) * remaining;
    }
  }

  const slots: SlotTarget[] = activeKeys.map((key) => {
    const w = activeWeights[key];
    return {
      slot: MAIN_SLOT_ENUM[key],
      time: MAIN_SLOT_TIMES[key],
      kcal: Math.round(dailyTargets.kcal * w.kcal),
      proteinG: Math.round(dailyTargets.proteinG * w.proteinG),
      carbsG: Math.round(dailyTargets.carbsG * w.carbsG),
      fatG: Math.round(dailyTargets.fatG * w.fatG),
    };
  });

  if (training && preTime && postTime) {
    slots.push({
      slot: "PRE_WORKOUT",
      time: preTime,
      kcal: Math.round(dailyTargets.kcal * PRE_WORKOUT_WEIGHTS.kcal),
      proteinG: Math.round(dailyTargets.proteinG * PRE_WORKOUT_WEIGHTS.proteinG),
      carbsG: Math.round(dailyTargets.carbsG * PRE_WORKOUT_WEIGHTS.carbsG),
      fatG: Math.round(dailyTargets.fatG * PRE_WORKOUT_WEIGHTS.fatG),
    });
    slots.push({
      slot: "POST_WORKOUT",
      time: postTime,
      kcal: Math.round(dailyTargets.kcal * POST_WORKOUT_WEIGHTS.kcal),
      proteinG: Math.round(dailyTargets.proteinG * POST_WORKOUT_WEIGHTS.proteinG),
      carbsG: Math.round(dailyTargets.carbsG * POST_WORKOUT_WEIGHTS.carbsG),
      fatG: Math.round(dailyTargets.fatG * POST_WORKOUT_WEIGHTS.fatG),
    });
  }

  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

export interface RecipeCandidate {
  id: string;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  mealSlots: MealSlot[];
  ingredients: string[];
  isTrending: boolean;
}

function scoreRecipe(
  recipe: RecipeCandidate,
  target: SlotTarget,
  likedFoods: string[],
  dislikedFoods: string[],
): number | null {
  const lowerIngredients = recipe.ingredients.map((i) => i.toLowerCase());
  const isDisliked = dislikedFoods.some((d) =>
    lowerIngredients.some((i) => i.includes(d.toLowerCase())),
  );
  if (isDisliked) return null;
  if (!recipe.mealSlots.includes(target.slot)) return null;

  // Absolute Kalorienhöhe der Rezeptdatenbank spielt kaum eine Rolle, weil die
  // Portion später gemeinsam über alle Slots auf die Tagesziele skaliert wird
  // (siehe computeJointPortionScales). Ausschlaggebend ist, wie gut die
  // Makro-Zusammensetzung (Protein/Carb/Fett-Anteil an den Kalorien) zum Ziel
  // passt, das bleibt beim Skalieren erhalten.
  const recipeProfile = macroProfile(recipe.kcal, recipe.proteinG, recipe.carbsG, recipe.fatG);
  const targetProfile = macroProfile(target.kcal, target.proteinG, target.carbsG, target.fatG);

  const profileDiff =
    Math.abs(recipeProfile.protein - targetProfile.protein) * 1.3 +
    Math.abs(recipeProfile.carbs - targetProfile.carbs) +
    Math.abs(recipeProfile.fat - targetProfile.fat);

  let score = -profileDiff;

  const likedMatch = likedFoods.some((l) =>
    lowerIngredients.some((i) => i.includes(l.toLowerCase())),
  );
  if (likedMatch) score += 0.5;
  if (recipe.isTrending) score += 0.2;

  return score;
}

/** Wählt das beste Rezept für einen Slot; vermeidet kürzlich verwendete Rezepte. */
export function selectRecipeForSlot(
  candidates: RecipeCandidate[],
  target: SlotTarget,
  likedFoods: string[],
  dislikedFoods: string[],
  excludeIds: Set<string>,
): RecipeCandidate | null {
  let best: { recipe: RecipeCandidate; score: number } | null = null;

  for (const recipe of candidates) {
    if (excludeIds.has(recipe.id)) continue;
    const score = scoreRecipe(recipe, target, likedFoods, dislikedFoods);
    if (score === null) continue;
    if (!best || score > best.score) best = { recipe, score };
  }

  // Fallback: falls alle Kandidaten schon benutzt wurden, Wiederholung erlauben.
  if (!best) {
    for (const recipe of candidates) {
      const score = scoreRecipe(recipe, target, likedFoods, dislikedFoods);
      if (score === null) continue;
      if (!best || score > best.score) best = { recipe, score };
    }
  }

  return best?.recipe ?? null;
}

const MIN_PORTION_SCALE = 0.4;
const MAX_PORTION_SCALE = 2.5;

/** Löst ein n×n-Gleichungssystem A·x = b per Gauß-Jordan (n ist klein, ≤ 8 Slots/Tag). */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    const pivotVal = M[col][col];
    if (Math.abs(pivotVal) < 1e-8) continue; // (nahezu) singulär in dieser Spalte -> überspringen

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / pivotVal;
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }

  return M.map((row, i) => (Math.abs(row[i]) < 1e-8 ? 0 : row[n] / row[i]));
}

/**
 * Skaliert alle gewählten Rezepte eines Tages GEMEINSAM so, dass die Summe über
 * Kalorien, Protein, Carbs UND Fett gleichzeitig möglichst genau die Tagesziele
 * trifft, nicht nur die Kalorien. Löst dafür ein leicht regularisiertes
 * Least-Squares-Problem (jede Makro-Gleichung wird relativ zu ihrem Zielwert
 * normalisiert, damit Kalorien nicht allein dominieren).
 *
 * Portionsgrenzen (0.4x–2.5x) werden per Active-Set-Verfahren behandelt: will
 * eine Mahlzeit über die Grenze hinaus skaliert werden, wird sie exakt auf die
 * Grenze fixiert und aus den freien Variablen entfernt, bevor der Rest neu
 * gelöst wird. Reines Nachträglich-Kappen (ohne das) lässt die übrigen
 * Mahlzeiten unkontrolliert überkompensieren und kann den Tag insgesamt weit
 * über oder unter das Kalorienziel schießen lassen.
 */
export function computeJointPortionScales(
  dailyTargets: MacroTarget,
  selected: { recipe: RecipeCandidate; priorScale: number }[],
): number[] {
  const n = selected.length;
  if (n === 0) return [];

  const targetVec = MACRO_KEYS.map((k) => Math.max(dailyTargets[k], 1));
  // M[k][i] = Anteil, den 1 Einheit Skalierung von Rezept i am Makro k relativ zum Tagesziel beiträgt.
  const M = MACRO_KEYS.map((k, ki) => selected.map((s) => s.recipe[k] / targetVec[ki]));
  const lambda = 0.01;

  const result: number[] = selected.map((s) => s.priorScale);
  const fixedAt: (number | null)[] = Array(n).fill(null);

  for (let pass = 0; pass < n; pass++) {
    const freeIdx: number[] = [];
    for (let i = 0; i < n; i++) if (fixedAt[i] === null) freeIdx.push(i);
    if (freeIdx.length === 0) break;

    const m = freeIdx.length;
    const A: number[][] = Array.from({ length: m }, () => Array(m).fill(0));
    const rhs: number[] = Array(m).fill(0);

    for (let ii = 0; ii < m; ii++) {
      const i = freeIdx[ii];
      for (let jj = 0; jj < m; jj++) {
        const j = freeIdx[jj];
        let sum = 0;
        for (let k = 0; k < MACRO_KEYS.length; k++) sum += M[k][i] * M[k][j];
        A[ii][jj] = sum + (ii === jj ? lambda : 0);
      }
      let fixedContribution = 0;
      for (let k = 0; k < MACRO_KEYS.length; k++) {
        let fixedSum = 0;
        for (let t = 0; t < n; t++) {
          if (fixedAt[t] !== null) fixedSum += M[k][t] * (fixedAt[t] as number);
        }
        fixedContribution += M[k][i] * fixedSum;
      }
      let targetSum = 0;
      for (let k = 0; k < MACRO_KEYS.length; k++) targetSum += M[k][i] * 1; // normalisiertes Ziel ist immer 1
      rhs[ii] = targetSum - fixedContribution + lambda * selected[i].priorScale;
    }

    const solvedFree = solveLinearSystem(A, rhs);
    for (let ii = 0; ii < m; ii++) {
      const v = solvedFree[ii];
      result[freeIdx[ii]] = Number.isFinite(v) ? v : selected[freeIdx[ii]].priorScale;
    }

    // Größte Grenzverletzung unter den freien Variablen fixieren, Rest neu lösen.
    let worstIdx = -1;
    let worstViolation = 1e-6;
    let worstBound = 0;
    for (const i of freeIdx) {
      if (result[i] < MIN_PORTION_SCALE && MIN_PORTION_SCALE - result[i] > worstViolation) {
        worstViolation = MIN_PORTION_SCALE - result[i];
        worstIdx = i;
        worstBound = MIN_PORTION_SCALE;
      } else if (result[i] > MAX_PORTION_SCALE && result[i] - MAX_PORTION_SCALE > worstViolation) {
        worstViolation = result[i] - MAX_PORTION_SCALE;
        worstIdx = i;
        worstBound = MAX_PORTION_SCALE;
      }
    }

    if (worstIdx === -1) break; // keine Verletzung mehr -> Lösung gültig
    fixedAt[worstIdx] = worstBound;
    result[worstIdx] = worstBound;
  }

  return result.map((v, i) => (Number.isFinite(v) ? v : selected[i].priorScale));
}

/** Einzelne Kalorien-basierte Schätzung, dient als Startwert/Anker für die gemeinsame Lösung oben. */
export function computePortionScale(target: SlotTarget, recipe: RecipeCandidate): number {
  const raw = target.kcal / Math.max(recipe.kcal, 1);
  return Math.min(Math.max(raw, MIN_PORTION_SCALE), MAX_PORTION_SCALE);
}
