import { requireHouseholdId, requireProfileId } from "@/lib/session";
import { listPantryItems } from "@/lib/pantry/pantryService";
import { groupRotationResultsForDisplay } from "@/lib/rotation/rotationEngine";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { getInsightsForProfile } from "@/lib/insights/insightService";
import { forSurface } from "@/lib/insights/dedupe";
import { InsightsPanel, type InsightView } from "@/components/insights/InsightsPanel";
import PantryClient, { type PantryItemView } from "./PantryClient";

export default async function PantryPage() {
  const householdId = await requireHouseholdId();
  const profileId = await requireProfileId();
  const items = await listPantryItems(householdId);

  const allInsights = await getInsightsForProfile(profileId);
  // Kein Link "Vorräte ansehen" hier - wir sind bereits auf /pantry, die
  // Aktion wäre ein Link auf die aktuelle Seite selbst.
  const insights: InsightView[] = forSurface(allInsights, "PANTRY").map((i) => ({
    id: i.id,
    message: i.message,
    priority: i.priority,
    action: i.action?.href === "/pantry" ? undefined : i.action,
  }));

  const itemViews: PantryItemView[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    remainingQuantity: item.remainingQuantity,
    unit: item.unit,
    category: item.category,
    purchaseDate: item.purchaseDate ? item.purchaseDate.toISOString() : null,
    expirationDate: item.expirationDate ? item.expirationDate.toISOString() : null,
    expirationDateType: item.expirationDateType,
    location: item.location,
    opened: item.opened,
    cooked: item.cooked,
    notes: item.notes,
    rotation: item.rotation,
  }));

  const { useFirst, planMeal } = groupRotationResultsForDisplay(items.map((item) => item.rotation));

  return (
    <div>
      <SectionHeader
        eyebrow="Vorräte"
        title="Deine Pantry"
        intro="Was du gerade zuhause hast. Fließt automatisch mit ein, wenn wir für dich entscheiden oder Rezepte vorschlagen."
      />
      {insights.length > 0 && (
        <div className="mt-8">
          <InsightsPanel initialInsights={insights} />
        </div>
      )}
      <div className="mt-10">
        <PantryClient
          initialItems={itemViews}
          useFirstIds={useFirst.map((r) => r.pantryItemId)}
          planMealIds={planMeal.map((r) => r.pantryItemId)}
        />
      </div>
    </div>
  );
}
