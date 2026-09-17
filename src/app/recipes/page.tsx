import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import RecipesList from "./RecipesList";
import { requireProfileId } from "@/lib/session";

export default async function RecipesPage() {
  const profileId = await requireProfileId();

  const custom = await prisma.recipe.findMany({
    where: { ownerProfileId: profileId, isCustom: true },
    orderBy: { createdAt: "desc" },
  });

  const recipes = custom.map((r) => dbRecipeToDetail(r));

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Deine Küche
          </span>
          <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">
            Meine Rezepte
          </h1>
          <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
            Selbst gekocht? Rein damit. Deine eigenen Gerichte fließen direkt in deinen
            personalisierten Essensplan mit ein.
          </p>
        </div>
        <Link
          href="/recipes/new"
          className="inline-flex shrink-0 items-center gap-2 rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-black"
        >
          <Plus className="h-4 w-4" /> Rezept hinzufügen
        </Link>
      </div>
      <div className="mt-10">
        <RecipesList recipes={recipes} />
      </div>
    </div>
  );
}
