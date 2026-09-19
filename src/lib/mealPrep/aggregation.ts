import type { PantryUnit } from "@prisma/client";
import { convertQuantity } from "../pantry/units";
import { normalizeIngredientKey, parseIngredientLine } from "./ingredientParser";
import type { AggregatedIngredient, SourceMealRef } from "./types";

export interface MealForAggregation {
  id: string;
  date: Date;
  slot: string;
  recipeId: string;
  recipeName: string;
  ingredients: string[];
  portionMultiplier: number;
}

export interface UnparsedIngredient {
  raw: string;
  recipeName: string;
}

/**
 * Basis-Einheit je physikalischer Dimension (deckt sich mit
 * pantry/units.ts:TO_BASE_FACTOR): Gewicht wird immer in g, Volumen immer in
 * ml summiert. Stück/Packung/Portion bleiben je ihre eigene, nicht
 * ineinander umrechenbare Dimension (siehe convertQuantity()), werden also
 * nie mit g/ml vermischt.
 */
function baseUnitFor(unit: PantryUnit): PantryUnit {
  if (unit === "G" || unit === "KG") return "G";
  if (unit === "ML" || unit === "L") return "ML";
  return unit;
}

/**
 * Fasst dieselbe Zutat über mehrere geplante Mahlzeiten hinweg zusammen
 * (Abschnitt 5). Nur Zeilen, die ingredientParser.ts strukturiert erkennt,
 * fließen ein - alles andere landet unverändert in `unparsed`, wird also nie
 * stillschweigend ignoriert. Inkompatible Einheiten (z.B. Gewicht vs. Stück
 * derselben Zutat) werden bewusst GETRENNT gehalten (Abschnitt 6), nie
 * zusammengerechnet.
 */
export function aggregateIngredients(meals: MealForAggregation[]): {
  aggregated: AggregatedIngredient[];
  unparsed: UnparsedIngredient[];
} {
  const groups = new Map<
    string,
    { normalizedName: string; displayName: string; unit: PantryUnit; totalQuantity: number; recipeIds: Set<string>; sourceMeals: SourceMealRef[] }
  >();
  const unparsed: UnparsedIngredient[] = [];

  for (const meal of meals) {
    for (const raw of meal.ingredients) {
      const parsed = parseIngredientLine(raw);
      if (!parsed) {
        unparsed.push({ raw, recipeName: meal.recipeName });
        continue;
      }

      const scaledQuantity = parsed.quantity * meal.portionMultiplier;
      const unit = baseUnitFor(parsed.unit);
      const converted = convertQuantity(scaledQuantity, parsed.unit, unit) ?? scaledQuantity;
      const normalizedName = normalizeIngredientKey(parsed.name);
      const groupKey = `${normalizedName}::${unit}`;

      const sourceMealRef: SourceMealRef = {
        mealId: meal.id,
        date: meal.date,
        slot: meal.slot,
        recipeId: meal.recipeId,
        recipeName: meal.recipeName,
        quantityForMeal: Math.round(converted * 100) / 100,
      };

      const existing = groups.get(groupKey);
      if (existing) {
        existing.totalQuantity += converted;
        existing.recipeIds.add(meal.recipeId);
        existing.sourceMeals.push(sourceMealRef);
      } else {
        groups.set(groupKey, {
          normalizedName,
          displayName: parsed.name,
          unit,
          totalQuantity: converted,
          recipeIds: new Set([meal.recipeId]),
          sourceMeals: [sourceMealRef],
        });
      }
    }
  }

  const aggregated: AggregatedIngredient[] = Array.from(groups.entries())
    .map(([groupKey, g]) => ({
      key: groupKey,
      normalizedName: g.normalizedName,
      displayName: g.displayName,
      unit: g.unit,
      totalQuantity: Math.round(g.totalQuantity * 100) / 100,
      recipeCount: g.recipeIds.size,
      sourceMeals: g.sourceMeals,
      pantry: null,
      costCents: null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { aggregated, unparsed };
}
