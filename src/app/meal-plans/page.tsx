import { requireSessionUserId } from "@/lib/session";
import { getCurrentHouseholdContextWithMembers } from "@/lib/household/context";
import { getMealPlan, listMealPlans } from "@/lib/mealPlanner/mealPlanService";
import { recipeAsPlanned } from "@/lib/recipeAsPlanned";
import { readJsonColumn } from "@/lib/validation/jsonColumn";
import { storedStringListSchema } from "@/lib/validation/jsonColumnSchemas";
import { SectionHeader } from "@/components/ui/SectionHeader";
import MealPlansClient, { type MealPlanDetailView, type MealPlanMealView, type MealPlanSummaryView, type MemberOptionView } from "./MealPlansClient";
import NoHouseholdNotice from "./NoHouseholdNotice";

export default async function MealPlansPage() {
  await requireSessionUserId();
  const ctx = await getCurrentHouseholdContextWithMembers();

  if (!ctx) {
    return (
      <div>
        <MealPlansHeader />
        <div className="mt-10">
          <NoHouseholdNotice />
        </div>
      </div>
    );
  }

  const plans = await listMealPlans(ctx.householdId);
  const mostRecent = plans[0] ?? null;
  const detail = mostRecent ? await getMealPlan(ctx.householdId, mostRecent.id) : null;

  const memberOptions: MemberOptionView[] = ctx.members.map((m) => ({
    householdMemberId: m.id,
    name: m.user.name ?? m.user.email ?? "Unbekannt",
  }));

  const planSummaries: MealPlanSummaryView[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    status: p.status,
    mealCount: p._count.meals,
  }));

  const detailView: MealPlanDetailView | null = detail
    ? {
        id: detail.id,
        name: detail.name,
        startDate: detail.startDate.toISOString(),
        endDate: detail.endDate.toISOString(),
        status: detail.status,
        members: detail.members.map((m) => ({
          householdMemberId: m.householdMemberId,
          name: m.householdMember?.user.name ?? null,
        })),
        meals: detail.meals.map((meal) => {
          const planned = recipeAsPlanned(meal);
          return {
            id: meal.id,
            date: meal.date.toISOString(),
            // MealPlanMeal.slot ist immer einer der vier planbaren Slots (siehe mealPlanner/plannerEngine.ts),
            // MealSlot als DB-Enum trägt zusätzlich PRE_WORKOUT/POST_WORKOUT (nur vom Single-Profile-Planner genutzt).
            slot: meal.slot as MealPlanMealView["slot"],
            recipeId: meal.recipeId,
            recipeName: planned.name,
            imageQuery: meal.recipe.imageQuery,
            kcal: Math.round(planned.kcal * meal.portionMultiplier),
            proteinG: Math.round(planned.proteinG * meal.portionMultiplier),
            portionMultiplier: meal.portionMultiplier,
            reasons: readJsonColumn({ model: "MealPlanMeal", id: meal.id, column: "reasons" }, meal.reasons, storedStringListSchema),
          };
        }),
      }
    : null;

  return (
    <div>
      <MealPlansHeader />
      <div className="mt-10">
        <MealPlansClient memberOptions={memberOptions} plans={planSummaries} initialDetail={detailView} />
      </div>
    </div>
  );
}

function MealPlansHeader() {
  return (
    <SectionHeader
      eyebrow="Meal Planner"
      title="Dein Essensplan"
      intro="Sag uns dein Ziel. Wir übernehmen den Rest: Vorräte, Abwechslung und die Ziele aller Haushaltsmitglieder fließen automatisch mit ein."
    />
  );
}
