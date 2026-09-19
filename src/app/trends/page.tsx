import { prisma } from "@/lib/db";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { SectionHeader } from "@/components/ui/SectionHeader";
import TrendsGrid from "./TrendsGrid";

export default async function TrendsPage() {
  const trending = await prisma.recipe.findMany({
    where: { isTrending: true },
    orderBy: { trendAddedAt: "desc" },
  });

  const recipes = trending.map((r) => dbRecipeToDetail(r));

  return (
    <div>
      <SectionHeader
        eyebrow="Laufend aktualisiert"
        title="Gerade im Trend"
        intro="Eine kuratierte Auswahl viraler Gerichte aus Social Media. Filtere nach dem, was dich interessiert."
      />
      <div className="mt-10">
        <TrendsGrid recipes={recipes} />
      </div>
    </div>
  );
}
