export interface MacroTolerances {
  caloriesPct: number;
  proteinPct: number;
  carbsPct: number;
  fatPct: number;
  fiberPct: number;
}

/**
 * Innerhalb dieser relativen Abweichung gilt ein Makro als "getroffen" und
 * trägt nichts zum Loss bei (siehe loss.ts). Zentral definiert, damit sich
 * niemand tief im Code eine eigene magische Zahl ausdenkt. Können pro Aufruf
 * überschrieben werden (`MacroRescueInput.tolerances`).
 */
export const DEFAULT_MACRO_TOLERANCES: MacroTolerances = {
  caloriesPct: 0.1,
  proteinPct: 0.15,
  carbsPct: 0.2,
  fatPct: 0.2,
  fiberPct: 0.25,
};
