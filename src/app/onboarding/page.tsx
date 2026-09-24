import { SectionHeader } from "@/components/ui/SectionHeader";
import { loadFoodCatalog } from "@/lib/recipes/recipeService";
import OnboardingForm from "./OnboardingForm";

// Die Vorschläge kommen aus dem FoodCatalog der Datenbank; nicht zur Build-Zeit einfrieren.
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const catalog = await loadFoodCatalog();
  const foods = catalog.all().map(({ id, name, aliases }) => ({ id, name, aliases }));

  return (
    <div>
      <SectionHeader
        eyebrow="2 Minuten Setup"
        title="Dein Profil"
        intro="Je genauer deine Angaben, desto präziser dein Plan, inklusive Timing rund ums Training."
      />
      <div className="mt-10">
        <OnboardingForm foods={foods} />
      </div>
    </div>
  );
}
