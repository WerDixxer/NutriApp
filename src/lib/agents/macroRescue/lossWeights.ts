export interface MacroLossWeights {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

/**
 * Zentral definierte Gewichtung der Loss-Funktion (loss.ts). Protein soll
 * nicht automatisch dominieren, deshalb liegen Protein/Carbs/Fett bewusst
 * nah bei Kalorien statt deutlich höher gewichtet zu sein. Kalorien zählen
 * minimal am meisten, weil sie den Gesamtrahmen der Mahlzeit setzen.
 * Fiber ist niedriger gewichtet und wird aktuell ohnehin nie ausgewertet
 * (kein Fiber-Feld am Rezept-Modell, siehe loss.ts).
 */
export const DEFAULT_MACRO_LOSS_WEIGHTS: MacroLossWeights = {
  calories: 1.0,
  protein: 0.9,
  carbs: 0.85,
  fat: 0.85,
  fiber: 0.5,
};
