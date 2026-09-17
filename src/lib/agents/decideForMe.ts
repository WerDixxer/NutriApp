import { prisma } from "../db";
import { getOrGenerateDayPlan } from "../generateMealPlan";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export interface Decision {
  itemId: string;
  slot: string;
  time: string;
  recipeId: string;
  portionMultiplier: number;
  reason: string;
}

/**
 * "Entscheide für mich": nutzt den ohnehin schon für heute generierten,
 * personalisierten Plan (der Trainingszeiten, Ziele und Präferenzen bereits
 * berücksichtigt) und schlägt daraus die zeitlich passendste, noch nicht
 * geloggte Mahlzeit vor, statt eine zweite, parallele Entscheidungslogik
 * aufzubauen, die vom Plan abweichen könnte.
 */
export async function decideForMe(profileId: string, now: Date = new Date()): Promise<Decision | null> {
  const today = startOfDay(now);
  const plan = await getOrGenerateDayPlan(profileId, today);

  const entries = await prisma.logEntry.findMany({
    where: { profileId, date: today },
    select: { slot: true },
  });
  const loggedSlots = new Set(entries.map((e) => e.slot));

  const unlogged = plan.items.filter((item) => !loggedSlots.has(item.slot));
  if (unlogged.length === 0) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  unlogged.sort(
    (a, b) => Math.abs(toMinutes(a.time) - nowMinutes) - Math.abs(toMinutes(b.time) - nowMinutes),
  );

  const chosen = unlogged[0];
  const diffMin = toMinutes(chosen.time) - nowMinutes;
  const reason =
    diffMin > 15
      ? `Als Nächstes um ${chosen.time} geplant.`
      : diffMin < -15
        ? `Stand für ${chosen.time} auf deinem Plan. Am besten jetzt nachholen.`
        : `Genau jetzt an der Reihe.`;

  return {
    itemId: chosen.id,
    slot: chosen.slot,
    time: chosen.time,
    recipeId: chosen.recipeId,
    portionMultiplier: chosen.portionMultiplier,
    reason,
  };
}
