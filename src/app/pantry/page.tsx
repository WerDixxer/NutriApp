import { requireHouseholdId } from "@/lib/session";
import { listPantryItems } from "@/lib/pantry/pantryService";
import PantryClient, { type PantryItemView } from "./PantryClient";

export default async function PantryPage() {
  const householdId = await requireHouseholdId();
  const items = await listPantryItems(householdId);

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

  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Vorräte</span>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">Deine Pantry</h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Was du gerade zuhause hast. Wird bereits berücksichtigt, wenn der Coach für dich entscheidet
        oder Rezepte vorschlägt.
      </p>
      <div className="mt-10">
        <PantryClient initialItems={itemViews} />
      </div>
    </div>
  );
}
