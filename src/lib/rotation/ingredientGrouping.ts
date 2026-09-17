export interface GroupableItem {
  id: string;
  ingredientId: string | null;
  name: string;
}

/**
 * Gruppiert Pantry Items NUR nach exaktem Ingredient-Katalog-Match
 * (`ingredientId`, siehe Kapitel 6 `findOrCreateIngredient` -> Normalisierung
 * über den Namen). Bewusst KEINE Fuzzy-/KI-Zusammenführung ähnlicher Namen
 * ("Tomate"/"Tomaten"/"Cherrytomaten" bleiben getrennt, solange sie nicht
 * denselben Katalogeintrag referenzieren), siehe Kapitel-Auftrag Abschnitt 6.
 * Items ohne Verknüpfung (`ingredientId === null`) bleiben jeweils in einer
 * eigenen Einzelgruppe, nie zusammengelegt.
 */
export function groupPantryItemsByIngredient<T extends GroupableItem>(items: T[]): T[][] {
  const groups = new Map<string, T[]>();
  const singles: T[][] = [];

  for (const item of items) {
    if (item.ingredientId) {
      const existing = groups.get(item.ingredientId);
      if (existing) existing.push(item);
      else groups.set(item.ingredientId, [item]);
    } else {
      singles.push([item]);
    }
  }

  return [...groups.values(), ...singles];
}
