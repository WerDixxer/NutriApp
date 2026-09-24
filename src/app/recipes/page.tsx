import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { dbRecipeToDetail } from "@/lib/recipeDetail";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { activeFilterCount, browseCatalog, buildCatalogCard, buildDiscoverSections, parseCatalogQuery } from "@/lib/recipes/catalogBrowser";
import { loadBrowsePreferences, loadCatalogRecipes, loadFoodCatalog } from "@/lib/recipes/recipeService";
import CatalogBrowser from "./CatalogBrowser";
import RecipesList from "./RecipesList";
import { requireProfileId } from "@/lib/session";

type SearchParams = Record<string, string | string[] | undefined>;

const TAB_CLASS =
  "inline-flex h-9 items-center rounded-full px-5 text-[13.5px] font-semibold transition-colors duration-[var(--duration-fast)]";

function Tabs({ active }: { active: "catalog" | "mine" }) {
  return (
    <nav aria-label="Rezeptbereich" className="inline-flex gap-1 rounded-full bg-bg-dim p-1">
      <Link
        href="/recipes"
        aria-current={active === "catalog" ? "page" : undefined}
        className={`${TAB_CLASS} ${active === "catalog" ? "bg-white text-ink shadow-[var(--shadow-soft)]" : "text-ink-soft hover:text-ink"}`}
      >
        Entdecken
      </Link>
      <Link
        href="/recipes?tab=mine"
        aria-current={active === "mine" ? "page" : undefined}
        className={`${TAB_CLASS} ${active === "mine" ? "bg-white text-ink shadow-[var(--shadow-soft)]" : "text-ink-soft hover:text-ink"}`}
      >
        Meine Rezepte
      </Link>
    </nav>
  );
}

async function MyRecipes({ profileId }: { profileId: string }) {
  const custom = await prisma.recipe.findMany({
    where: { ownerProfileId: profileId, isCustom: true },
    orderBy: { createdAt: "desc" },
  });
  return <RecipesList recipes={custom.map((r) => dbRecipeToDetail(r))} />;
}

async function Catalog({ profileId, params }: { profileId: string; params: SearchParams }) {
  const query = parseCatalogQuery(params);
  const [entries, catalog, preferences] = await Promise.all([
    loadCatalogRecipes(),
    loadFoodCatalog(),
    loadBrowsePreferences(profileId),
  ]);

  if (entries.length === 0) {
    return <EmptyState title="Der Katalog ist noch leer" description="Sobald Katalog-Rezepte geladen sind, findest du sie hier." />;
  }

  const rowById = new Map(entries.map((e) => [e.recipe.id, e.row]));
  const result = browseCatalog(entries.map((e) => e.recipe), query, preferences, catalog);
  const variantById = new Map(result.items.map((item) => [item.recipe.id, item.variant]));
  const toCard = (recipe: (typeof result.items)[number]["recipe"], flags: (typeof result.items)[number]["flags"]) =>
    buildCatalogCard(recipe, flags, rowById.get(recipe.id)!, variantById.get(recipe.id) ?? null);

  // Ohne Suche und Filter (und ohne die Allergie-Ansicht) zeigt "Entdecken" Bereiche, sonst die Trefferliste.
  const discover = query.q === "" && activeFilterCount(query.filter) === 0 && !query.showBlocked;

  return (
    <CatalogBrowser
      query={query}
      cards={discover ? [] : result.items.map(({ recipe, flags }) => toCard(recipe, flags))}
      sections={discover ? buildDiscoverSections(result.items, toCard) : null}
      resultCount={result.items.length}
      blockedCount={result.blockedCount}
      catalogSize={result.catalogSize}
    />
  );
}

export default async function RecipesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const profileId = await requireProfileId();
  const params = await searchParams;
  const tab = params.tab === "mine" ? "mine" : "catalog";

  return (
    <div>
      <SectionHeader
        eyebrow="Rezeptbibliothek"
        title="Rezepte"
        intro={
          tab === "mine"
            ? "Selbst gekocht? Rein damit. Deine eigenen Gerichte fließen direkt in deinen Essensplan mit ein."
            : "Durchsuche den Katalog nach Gericht, Zutat, Mahlzeit oder Ziel."
        }
        action={
          <Link
            href="/recipes/new"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-white transition-colors duration-[var(--duration-fast)] hover:bg-black"
          >
            <Plus className="h-4 w-4" /> Rezept hinzufügen
          </Link>
        }
      />
      <div className="mt-8">
        <Tabs active={tab} />
      </div>
      <div className="mt-8">
        {tab === "mine" ? <MyRecipes profileId={profileId} /> : <Catalog profileId={profileId} params={params} />}
      </div>
    </div>
  );
}
