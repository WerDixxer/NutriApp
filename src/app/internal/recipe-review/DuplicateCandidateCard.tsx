import type { ReviewDuplicateCandidate } from "@/lib/recipes/recipeReview";

/**
 * Aus `[id]/page.tsx` extrahiert (Kapitel 20): die Import-Vorschau (`import-preview/page.tsx`)
 * zeigt Duplicate-Kandidaten für Import-Kandidaten mit genau derselben Karte wie die Detailseite
 * für echte Katalog-Rezepte - keine zweite Darstellung für denselben `ReviewDuplicateCandidate`-Typ.
 */
export function percent(value: number | null): string | null {
  return value === null ? null : `${Math.round(value * 100)}%`;
}

export function DuplicateCandidateCard({ recipeName, candidate }: { recipeName: string; candidate: ReviewDuplicateCandidate }) {
  const ingredientOverlap = percent(candidate.ingredientOverlap);
  const nameOverlap = percent(candidate.nameOverlap);
  return (
    <li className="rounded-[var(--radius-md)] bg-bg-dim p-4">
      <p className="text-[14px] font-semibold text-ink">
        {recipeName} <span className="font-normal text-ink-faint">vs.</span> {candidate.recipe.name}
      </p>
      <p className="num mt-1 text-[13px] text-ink-soft">
        {candidate.kind === "exact" ? "Exakte strukturelle Übereinstimmung" : `Similarity: ${candidate.score.toFixed(2)}`}
        {ingredientOverlap && ` · Zutaten-Überlappung: ${ingredientOverlap}`}
        {nameOverlap && ` · Namensüberlappung: ${nameOverlap}`}
      </p>
      {candidate.dietClassDiffers && (
        <p className="mt-1 text-[12.5px] font-medium text-warn">Unterschiedliche Ernährungsform – kein automatisches Duplicate.</p>
      )}
      {candidate.sharedFeatures.length > 0 && (
        <div className="mt-2">
          <p className="text-[12px] font-semibold text-ink-soft">Gemeinsame Ingredients:</p>
          <ul className="mt-1 list-inside list-disc text-[13px] text-ink-soft">
            {candidate.sharedFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
