import { getOrGenerateDayPlan } from "@/lib/generateMealPlan";
import { WEEKDAY_LABELS } from "@/lib/labels";
import { approxKcal } from "@/lib/format";
import { requireProfileId } from "@/lib/session";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function mondayOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const weekday = (d.getDay() + 6) % 7; // 0 = Montag
  d.setDate(d.getDate() - weekday);
  return d;
}

const EMOJI_BY_SLOT: Record<string, string> = {
  BREAKFAST: "🥣",
  LUNCH: "🍽️",
  DINNER: "🍜",
  SNACK: "🍎",
  PRE_WORKOUT: "⚡",
  POST_WORKOUT: "🥤",
};

export default async function WeekPlanPage() {
  const profileId = await requireProfileId();

  const monday = mondayOfWeek(new Date());
  const today = startOfDay(new Date());

  const days = await Promise.all(
    Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      return getOrGenerateDayPlan(profileId, date).then((plan) => ({ date, plan }));
    }),
  );

  return (
    <div>
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
        Diese Woche
      </span>
      <h1 className="font-display mt-2 text-[40px] leading-[1.03] text-ink sm:text-[52px]">
        Dein Wochenplan
      </h1>
      <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-soft">
        Alle sieben Tage auf einen Blick, inklusive Timing rund um deine Trainingseinheiten.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {days.map(({ date, plan }, i) => {
          const isToday = date.getTime() === today.getTime();
          const dayTotalKcal = plan.items.reduce(
            (sum, item) => sum + item.recipe.kcal * item.portionMultiplier,
            0,
          );
          return (
            <div key={date.toISOString()} className="flex flex-col gap-3 border-t-2 border-border pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-display text-lg font-semibold text-ink">
                    {WEEKDAY_LABELS[i]}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {date.toLocaleDateString("de-DE", { day: "2-digit", month: "long" })}
                  </div>
                </div>
                {isToday && (
                  <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                    Heute
                  </span>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {plan.items.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-sm">
                    <span className="text-base leading-none">{EMOJI_BY_SLOT[item.slot] ?? "🍽️"}</span>
                    <span className="w-11 shrink-0 text-xs text-ink-soft">{item.time}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{item.recipe.name}</span>
                  </div>
                ))}
                {plan.items.length === 0 && (
                  <p className="text-sm text-ink-soft">Kein Plan verfügbar.</p>
                )}
              </div>

              <div className="mt-1 border-t border-border pt-3 text-xs text-ink-soft">
                {approxKcal(dayTotalKcal)} über {plan.items.length}{" "}
                {plan.items.length === 1 ? "Mahlzeit" : "Mahlzeiten"}
                {plan.items.some((i) => i.slot === "PRE_WORKOUT" || i.slot === "POST_WORKOUT") && (
                  <span> · Training berücksichtigt</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
