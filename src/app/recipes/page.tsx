import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { SectionHeader } from "@/components/ui/SectionHeader";
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
      <SectionHeader
        eyebrow="Deine Küche"
        title="Meine Rezepte"
        intro="Selbst gekocht? Rein damit. Deine eigenen Gerichte fließen direkt in deinen Essensplan mit ein."
        action={
          <Link
            href="/recipes/new"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:bg-black"
          >
            <Plus className="h-4 w-4" /> Rezept hinzufügen
          </Link>
        }
      />
      <div className="mt-10">
        <RecipesList recipes={recipes} />
      </div>
    </div>
  );
}
