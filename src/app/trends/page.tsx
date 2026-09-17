import { prisma } from "@/lib/db";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import TrendsGrid from "./TrendsGrid";

export default async function TrendsPage() {
  const trending = await prisma.recipe.findMany({
    where: { isTrending: true },
    orderBy: { trendAddedAt: "desc" },
  });

  const recipes = trending.map((r) => dbRecipeToDetail(r));

  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Laufend aktualisiert
      </span>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">
        Gerade im Trend
      </h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Kuratierte Auswahl aktuell viraler Gerichte aus Social Media: Insta Reels, TikTok,
        YouTube Shorts. Wähle Tags aus, um deinen Feed auf das einzugrenzen, was dich
        interessiert.
      </p>
      <div className="mt-10">
        <TrendsGrid recipes={recipes} />
      </div>
    </div>
  );
}
