import type { Prisma } from "@prisma/client";

/**
 * Welche Rezepte ein Profil sehen und verwenden darf: alle Katalogrezepte (`isCustom: false`) und die
 * eigenen Rezepte (`ownerProfileId`). Dieselbe Regel steht bislang inline im Tagesplaner, in Insights,
 * Decision Engine, Macro Rescue und Assistent; der Haushaltsplaner erweitert sie auf alle geplanten
 * Mitglieder. Beide Funktionen hier müssen dieselbe Regel ausdrücken - einmal als Abfrage, einmal für
 * ein bereits geladenes Rezept.
 */
export function recipesVisibleTo(profileId: string) {
  return { OR: [{ isCustom: false }, { ownerProfileId: profileId }] } satisfies Prisma.RecipeWhereInput;
}

/** Dieselbe Regel wie `recipesVisibleTo`, für ein bereits geladenes Rezept. */
export function isRecipeVisibleTo(recipe: { isCustom: boolean; ownerProfileId: string | null }, profileId: string): boolean {
  return !recipe.isCustom || recipe.ownerProfileId === profileId;
}
