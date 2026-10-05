import type { DietType, MealSlot, Prisma } from "@prisma/client";
import { addDays, fromDbDate, startOfWeek, toDbDate, weekdayIndex, type CalendarDate } from "./calendarDate";
import { prisma } from "./db";
import { isUniqueConstraintError } from "./prismaErrors";
import { isBeyondAutomaticPlanningHorizon, isHistoricalPlanDay, lastAutomaticallyPlannableDay } from "./planDayBoundary";
import { PLAN_RELEVANT_PROFILE_SELECT, type PlanRelevantProfileRow } from "./planRelevantProfile";
import { calcFullTargets, type FullTargets } from "./nutrition";
import { fitsProfileHardRules } from "./foodMatching";
import { createFoodPreferenceContext, isDislikedHit, isLikedHit, type FoodPreferenceContext } from "./recipes/foodPreferences";
import { loadFoodCatalog, loadStructuredIngredients } from "./recipes/recipeService";
import { readRecipeDietTypes, readRecipeMealSlots, readRecipeStringList } from "./recipes/recipeJsonColumns";
import { recipeAsPlanned, recipeSnapshotOf, type RecipeSnapshot } from "./recipeAsPlanned";
import { skipUnreadableRows } from "./validation/jsonColumn";
import type { StructuredIngredient } from "./recipes/types";
import {
  MAX_VARIETY_ACCURACY_LOSS,
  buildDayPlan,
  computeJointPortionScales,
  computePortionScale,
  dayMacroDeviation,
  selectRecipeForSlot,
  type RecipeCandidate,
  type SlotTarget,
} from "./planner";

/**
 * Rezept-ID -> wie oft das Rezept in der laufenden Wochenplanung bereits
 * gewählt wurde. Gilt nur für einen Generierungslauf (nie modulweit oder in
 * der DB gespeichert) und geht als weicher Abschlag in die Rezeptwahl ein,
 * siehe planner.ts:repetitionPenalty().
 */
export type RecipeUsage = Map<string, number>;

function addUsage(usage: RecipeUsage, recipeIds: string[]) {
  for (const id of recipeIds) usage.set(id, (usage.get(id) ?? 0) + 1);
}

/**
 * Bereits gespeicherte Tage derselben Woche (Montag bis Sonntag), damit auch einzeln erzeugte Tage (Dashboard) zur Woche passen.
 * `onlyBefore`: nur Tage vor diesem Kalendertag zählen - bei der Neuplanung die historischen Tage, die bestehen bleiben.
 */
async function loadWeekUsage(profileId: string, day: CalendarDate, onlyBefore?: CalendarDate): Promise<RecipeUsage> {
  const monday = startOfWeek(day);
  const days = await prisma.mealPlanDay.findMany({
    where: {
      profileId,
      date: { gte: toDbDate(monday), lte: toDbDate(addDays(monday, 6)), ...(onlyBefore ? { lt: toDbDate(onlyBefore) } : {}) },
    },
    select: { items: { select: { recipeId: true } } },
  });
  const usage: RecipeUsage = new Map();
  for (const d of days) addUsage(usage, d.items.map((item) => item.recipeId));
  return usage;
}

const DAY_PLAN_INCLUDE = { items: { include: { recipe: true }, orderBy: { time: "asc" } } } satisfies Prisma.MealPlanDayInclude;

function findStoredDayPlan(profileId: string, day: CalendarDate) {
  return prisma.mealPlanDay.findUnique({ where: { profileId_date: { profileId, date: toDbDate(day) } }, include: DAY_PLAN_INCLUDE });
}

/** Ein fertig geplanter, noch nicht gespeicherter Tag: Tagesziele und Mahlzeiten. */
interface PlannedDay {
  targetKcal: number;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  /** Je Mahlzeit mit Rezept-Snapshot (Name und Nährwerte je Portion zum Planungszeitpunkt, siehe recipeAsPlanned.ts). */
  items: ({ slot: MealSlot; time: string; recipeId: string; portionMultiplier: number } & RecipeSnapshot)[];
}

function dayPlanCreateData(profileId: string, day: CalendarDate, plan: PlannedDay) {
  const { items, ...targets } = plan;
  return { profileId, date: toDbDate(day), ...targets, items: { create: items } } satisfies Prisma.MealPlanDayUncheckedCreateInput;
}

/**
 * Speichert einen neu erzeugten Tag. Hat ein paralleler Request (z.B. Dashboard und Food Assistant
 * gleichzeitig, oder /plan in zwei Tabs) denselben Tag inzwischen gespeichert, verletzt das den
 * Unique-Index [profileId, date]. Dann gilt der zuerst gespeicherte Plan, damit beide Aufrufe
 * denselben stabilen Tag zeigen - genau wie bei einem Aufruf kurz danach.
 */
async function saveDayPlan(profileId: string, day: CalendarDate, plan: PlannedDay) {
  try {
    return await prisma.mealPlanDay.create({ data: dayPlanCreateData(profileId, day, plan), include: DAY_PLAN_INCLUDE });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const savedConcurrently = await findStoredDayPlan(profileId, day);
    if (!savedConcurrently) throw error;
    return savedConcurrently;
  }
}

/**
 * Holt den Plan für einen Tag aus der DB, oder generiert und speichert ihn,
 * falls noch keiner existiert. Ein einmal generierter Tag bleibt stabil,
 * damit Nutzer sich darauf verlassen können (kein Neu-Mischen bei jedem Aufruf).
 *
 * `day` ist ein Kalendertag des Nutzers (z.B. `todayForUser()`), kein Zeitpunkt:
 * Ein Plan gehört zu Profil + Kalendertag, unabhängig von der Serverzeitzone.
 *
 * `today` ist der Kalendertag des Nutzers, den der Aufrufer einmal pro Request bestimmt
 * (`todayForUser`). Ein historischer Tag (vor `today`, siehe planDayBoundary.ts) wird nur
 * gelesen: gibt es keinen gespeicherten Plan, ist das Ergebnis `null` - er wird nie
 * nachträglich erzeugt (R5E). Ebenso ein Tag hinter dem Planungshorizont (nach dem Sonntag der
 * nächsten Woche, R5F-13): ein gespeicherter Plan wird unverändert geliefert, ein fehlender nicht erzeugt.
 *
 * `weekUsage`: Rezeptverwendung der laufenden Wochenplanung (siehe
 * getOrGenerateWeekPlan). Wird sie nicht übergeben, wird sie aus den bereits
 * gespeicherten Tagen derselben Woche gelesen. Ein neu erzeugter Tag trägt
 * seine Rezepte in `weekUsage` ein; ein bereits gespeicherter Tag ändert sie nicht.
 * Hat ein paralleler Request den Tag während der Erzeugung gespeichert, zählen
 * dessen Rezepte (sie standen noch nicht in `weekUsage`).
 */
export async function getOrGenerateDayPlan(profileId: string, day: CalendarDate, today: CalendarDate, weekUsage?: RecipeUsage) {
  return getOrGenerateDay(profileId, day, today, weekUsage, loadDayPlanningInputsOnce(profileId));
}

/** getOrGenerateDayPlan mit den gemeinsamen Planungsdaten der laufenden Operation (z.B. der ganzen Woche). */
async function getOrGenerateDay(
  profileId: string,
  day: CalendarDate,
  today: CalendarDate,
  weekUsage: RecipeUsage | undefined,
  planningInputs: () => Promise<DayPlanningInputs>,
) {
  const existing = await findStoredDayPlan(profileId, day);
  if (existing) return existing;
  if (isHistoricalPlanDay(day, today)) return null;
  if (isBeyondAutomaticPlanningHorizon(day, today)) return null;

  const usage = weekUsage ?? (await loadWeekUsage(profileId, day));
  const saved = await saveDayPlan(profileId, day, planDay(await planningInputs(), day, usage));

  addUsage(usage, saved.items.map((item) => item.recipeId));
  return saved;
}

/** Was die Rezeptauswahl vom Profil braucht - immer der aktuelle Stand. */
interface CandidateProfile {
  id: string;
  dietType: DietType;
  allergies: { label: string }[];
  likedFoods: { label: string }[];
  dislikedFoods: { label: string }[];
}

/**
 * Der Kandidatenpool des Profils je Slot: Katalog- und eigene Rezepte, die zur Ernährungsform passen
 * und keine Allergie treffen (harte Ausschlüsse), mit aufgelösten Vorlieben/Abneigungen. Gemeinsame
 * Grundlage für das Planen eines Tages (planDay) und das Ersetzen einer Mahlzeit (replacePlannedMeal).
 */
async function loadRecipeCandidates(profile: CandidateProfile) {
  const allRecipes = await prisma.recipe.findMany({
    where: { OR: [{ isCustom: false }, { ownerProfileId: profile.id }] },
  });
  const allergyLabels = profile.allergies.map((a) => a.label);
  const dislikedLabels = profile.dislikedFoods.map((d) => d.label);
  const likedLabels = profile.likedFoods.map((l) => l.label);
  const hasPreferences = likedLabels.length + dislikedLabels.length > 0;

  // Der Katalog wird nur gebraucht, wenn es Allergien oder Präferenzen gibt.
  const catalog = allergyLabels.length > 0 || hasPreferences ? await loadFoodCatalog() : undefined;

  // Allergien sind ein harter Ausschluss (gemeinsame Auflösung, siehe recipes/allergens.ts).
  // JSON-Spalten einmal geprüft lesen; ein unlesbares Rezept fällt mit Warnung aus dem Pool (R5D).
  const readableRecipes = skipUnreadableRows(allRecipes, (r) => ({
    row: r,
    dietTypes: readRecipeDietTypes(r),
    allergens: readRecipeStringList(r, "allergens"),
    ingredients: readRecipeStringList(r, "ingredients"),
    mealSlots: readRecipeMealSlots(r),
  }));
  const compatibleRecipes = readableRecipes.filter((r) =>
    fitsProfileHardRules(r, { dietType: profile.dietType, allergies: allergyLabels }, catalog),
  );

  // Lieblinge/Abneigungen über die gemeinsame Food-Auflösung (Katalog für strukturierte
  // Rezepte, Text für Altrezepte). Nur laden, wenn es überhaupt Präferenzen gibt.
  let preferences: FoodPreferenceContext | null = null;
  let structuredByRecipe = new Map<string, StructuredIngredient[]>();
  if (hasPreferences && catalog) {
    structuredByRecipe = await loadStructuredIngredients(compatibleRecipes.map((r) => r.row.id));
    preferences = createFoodPreferenceContext({ favoriteFoods: likedLabels, dislikedFoods: dislikedLabels }, catalog);
  }

  const candidatesBySlot = new Map<MealSlot, RecipeCandidate[]>();
  for (const { row: r, mealSlots, ingredients } of compatibleRecipes) {
    const match = preferences?.matchFor({ id: r.id, ingredients, structured: structuredByRecipe.get(r.id) });
    const candidate: RecipeCandidate = {
      id: r.id,
      name: r.name,
      kcal: r.kcal,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      mealSlots,
      ingredients,
      isTrending: r.isTrending,
      ...(match ? { preferenceHit: { liked: isLikedHit(match), disliked: isDislikedHit(match) } } : {}),
    };
    for (const slot of mealSlots) {
      if (!candidatesBySlot.has(slot)) candidatesBySlot.set(slot, []);
      candidatesBySlot.get(slot)!.push(candidate);
    }
  }

  return { candidatesBySlot, likedLabels, dislikedLabels };
}

type RecipeCandidatePool = Awaited<ReturnType<typeof loadRecipeCandidates>>;

/**
 * Was für alle Tage einer Planungsoperation gleich ist (R5F-11): die Tagesziele und das Training aus
 * dem aktuellen Profil sowie der Kandidatenpool. Wird je Operation (Einzeltag, Woche, Neuplanung)
 * einmal geladen statt für jeden Tag erneut.
 */
interface DayPlanningInputs {
  targets: FullTargets;
  trainingSessions: PlanRelevantProfileRow["trainingSessions"];
  pool: RecipeCandidatePool;
}

async function loadDayPlanningInputs(profileId: string): Promise<DayPlanningInputs> {
  // Nur die Sicht des Planers (planRelevantProfile.ts) - Profiländerungen daran erkennt die Profil-Route.
  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId }, select: PLAN_RELEVANT_PROFILE_SELECT });

  const targets = calcFullTargets({
    sex: profile.sex,
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    goalRateKgPerWeek: profile.goalRateKgPerWeek,
    sportType: profile.sportType,
  });

  return { targets, trainingSessions: profile.trainingSessions, pool: await loadRecipeCandidates(profile) };
}

/**
 * Lädt die gemeinsamen Planungsdaten erst, wenn tatsächlich ein Tag geplant wird, und dann nur einmal:
 * Eine Woche aus lauter gespeicherten Tagen lädt weder Profil noch Rezepte.
 */
function loadDayPlanningInputsOnce(profileId: string): () => Promise<DayPlanningInputs> {
  let inputs: Promise<DayPlanningInputs> | undefined;
  return () => (inputs ??= loadDayPlanningInputs(profileId));
}

/** Die Slots des Tages mit Uhrzeit und Teilzielen; an Trainingstagen (erste Einheit des Wochentags) mit Pre-/Post-Workout. */
function slotTargetsForDay({ targets, trainingSessions }: DayPlanningInputs, day: CalendarDate): SlotTarget[] {
  const weekday = weekdayIndex(day); // 0 = Montag, wie TrainingSession.weekday
  const todaysSession = trainingSessions.find((s) => s.weekday === weekday);

  return buildDayPlan(
    targets,
    todaysSession
      ? {
          startTime: todaysSession.startTime,
          durationMin: todaysSession.durationMin,
          sportType: todaysSession.sportType,
        }
      : undefined,
  );
}

/**
 * Wählt je Slot ein Rezept aus dem Pool (Rezepte des Tages möglichst nicht doppelt, `weekUsage` als
 * weicher Abschlag) und skaliert alle gemeinsam auf die Tagesziele.
 */
function pickRecipesForDay(
  { candidatesBySlot, likedLabels, dislikedLabels }: RecipeCandidatePool,
  slotTargets: SlotTarget[],
  targets: FullTargets,
  weekUsage?: RecipeUsage,
) {
  const usedRecipeIds = new Set<string>();
  const items: {
    slot: MealSlot;
    time: string;
    recipeId: string;
    recipe: RecipeCandidate;
    priorScale: number;
  }[] = [];

  for (const slotTarget of slotTargets) {
    const candidates = candidatesBySlot.get(slotTarget.slot) ?? [];
    const chosen = selectRecipeForSlot(
      candidates,
      slotTarget,
      likedLabels,
      dislikedLabels,
      usedRecipeIds,
      weekUsage,
    );
    if (!chosen) continue;

    usedRecipeIds.add(chosen.id);
    items.push({
      slot: slotTarget.slot,
      time: slotTarget.time,
      recipeId: chosen.id,
      recipe: chosen,
      priorScale: computePortionScale(slotTarget, chosen),
    });
  }

  // Alle gewählten Rezepte gemeinsam auf die Tagesziele skalieren, statt jede
  // Mahlzeit isoliert nur auf ihr Kalorien-Teilziel zu bringen. So treffen am
  // Ende auch Protein/Carbs/Fett in Summe die Tagesziele, nicht nur die Kalorien.
  const scales = computeJointPortionScales(
    targets,
    items.map((item) => ({ recipe: item.recipe, priorScale: item.priorScale })),
  );
  const deviation = dayMacroDeviation(
    targets,
    items.map((item, i) => ({ recipe: item.recipe, scale: scales[i] ?? item.priorScale })),
  );
  return { items, scales, deviation };
}

/**
 * Plant einen Tag mit dem aktuellen Profil (Ziele, Training, Ernährungsform, Allergien, Vorlieben)
 * und speichert nichts. `usage` ist die Rezeptverwendung der laufenden Wochenplanung und wird nur
 * gelesen; das Eintragen der gewählten Rezepte übernimmt der Aufrufer.
 */
function planDay(inputs: DayPlanningInputs, day: CalendarDate, usage: RecipeUsage): PlannedDay {
  const { targets, pool } = inputs;
  const slotTargets = slotTargetsForDay(inputs, day);

  // Variety ist nur eine Präferenz: Trifft der Tag mit den abwechslungsreicheren
  // Rezepten die Tagesziele spürbar schlechter als ohne Wochenabschlag (z.B. weil
  // sich mehrere sehr proteinreiche Gerichte stapeln), gilt die Auswahl ohne Abschlag.
  let picked = pickRecipesForDay(pool, slotTargets, targets, usage);
  if (usage.size > 0) {
    const plain = pickRecipesForDay(pool, slotTargets, targets);
    if (picked.deviation > plain.deviation + MAX_VARIETY_ACCURACY_LOSS) picked = plain;
  }
  const { items: chosenItems, scales: jointScales } = picked;

  return {
    targetKcal: targets.kcal,
    targetProteinG: targets.proteinG,
    targetCarbsG: targets.carbsG,
    targetFatG: targets.fatG,
    items: chosenItems.map((item, i) => ({
      slot: item.slot,
      time: item.time,
      recipeId: item.recipeId,
      portionMultiplier: jointScales[i] ?? item.priorScale,
      ...recipeSnapshotOf(item.recipe),
    })),
  };
}

/**
 * Die sieben Tage ab `weekStart` (Montag) in Reihenfolge. Fehlende Tage werden
 * nacheinander erzeugt (nicht parallel), weil jeder Tag wissen muss, welche
 * Rezepte die Tage davor gewählt haben. Bereits gespeicherte Tage bleiben
 * unverändert, zählen aber ebenfalls für die Rezeptverwendung, auch wenn sie
 * später in der Woche liegen als ein neu erzeugter Tag.
 *
 * Historische Tage (vor `today`) ohne gespeicherten Plan bleiben `null`, siehe
 * getOrGenerateDayPlan - die Woche erzeugt nur heute und die Zukunft.
 */
export async function getOrGenerateWeekPlan(profileId: string, weekStart: CalendarDate, today: CalendarDate) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const stored = await prisma.mealPlanDay.findMany({
    where: { profileId, date: { gte: toDbDate(days[0]), lte: toDbDate(days[6]) } },
    include: DAY_PLAN_INCLUDE,
  });
  const storedByDay = new Map(stored.map((d) => [fromDbDate(d.date), d]));

  const usage: RecipeUsage = new Map();
  for (const d of stored) addUsage(usage, d.items.map((item) => item.recipeId));

  const planningInputs = loadDayPlanningInputsOnce(profileId);
  const plans = [];
  for (const day of days) {
    plans.push(storedByDay.get(day) ?? (await getOrGenerateDay(profileId, day, today, usage, planningInputs)));
  }
  return plans;
}

/**
 * Die Kalendertage, deren gespeicherte Pläne neu geplant werden dürfen: heute bis zum Ende des
 * Planungshorizonts (planDayBoundary.ts). Historische Tage und gespeicherte Tage dahinter bleiben unberührt.
 */
function editableDateRange(today: CalendarDate) {
  return { gte: toDbDate(today), lte: toDbDate(lastAutomaticallyPlannableDay(today)) };
}

/** Die gespeicherten bearbeitbaren Tage des Profils (heute bis Ende des Planungshorizonts), aufsteigend. */
async function findStoredEditableDays(profileId: string, today: CalendarDate): Promise<CalendarDate[]> {
  const days = await prisma.mealPlanDay.findMany({
    where: { profileId, date: editableDateRange(today) },
    select: { date: true },
    orderBy: { date: "asc" },
  });
  return days.map((d) => fromDbDate(d.date));
}

/** Gibt es gespeicherte bearbeitbare Tage (heute bis Ende des Planungshorizonts)? Rein lesend, erzeugt keinen Tag. */
export async function hasStoredEditableDays(profileId: string, today: CalendarDate): Promise<boolean> {
  const day = await prisma.mealPlanDay.findFirst({ where: { profileId, date: editableDateRange(today) }, select: { id: true } });
  return day !== null;
}

/**
 * Die Slots, für die an `day` schon ein Log-Eintrag existiert. Plan und Log gehören - wie auf dem
 * Dashboard - allein über den Slot zusammen: ein geloggter Slot gilt für alle Mahlzeiten dieses Slots.
 */
async function loadLoggedSlots(profileId: string, day: CalendarDate): Promise<MealSlot[]> {
  const entries = await prisma.logEntry.findMany({ where: { profileId, date: toDbDate(day) }, select: { slot: true } });
  return [...new Set(entries.map((entry) => entry.slot))];
}

/** Ein neu geplanter Tag, wie ihn replaceEditableDayPlans speichert. */
interface RegeneratedDay {
  day: CalendarDate;
  /** Die neu geplanten Mahlzeiten - ohne die Slots in `keptSlots`. */
  plan: PlannedDay;
  /** Nur heute: bereits geloggte Slots. Ihre gespeicherten Mahlzeiten bleiben unverändert (samt Snapshot). */
  keptSlots: MealSlot[];
}

/**
 * Ersetzt die gespeicherten Tage durch ihre Neuplanung in EINER Transaktion: Scheitert ein Schritt,
 * bleiben alle alten Tage erhalten. Der Datumsfilter (editableDateRange) schützt historische Tage und
 * gespeicherte Tage hinter dem Planungshorizont zusätzlich auf Datenbankebene; die Einträge der alten
 * Tage gehen per Cascade mit, Log-Einträge hängen nicht daran.
 *
 * Ein Tag mit behaltenen Slots (heute, schon teilweise geloggt) bleibt als Zeile bestehen: Nur die
 * Mahlzeiten der übrigen Slots werden ersetzt, die Tagesziele auf das aktuelle Profil gesetzt.
 */
async function replaceEditableDayPlans(profileId: string, today: CalendarDate, regeneratedDays: RegeneratedDay[]) {
  const fullyReplaced = regeneratedDays.filter(({ keptSlots }) => keptSlots.length === 0);
  const partlyReplaced = regeneratedDays.filter(({ keptSlots }) => keptSlots.length > 0);

  await prisma.$transaction([
    prisma.mealPlanDay.deleteMany({
      where: { profileId, date: { in: fullyReplaced.map(({ day }) => toDbDate(day)), ...editableDateRange(today) } },
    }),
    ...fullyReplaced.map(({ day, plan }) => prisma.mealPlanDay.create({ data: dayPlanCreateData(profileId, day, plan) })),
    ...partlyReplaced.flatMap(({ day, plan, keptSlots }) => {
      const { items, ...targets } = plan;
      return [
        prisma.mealPlanItem.deleteMany({ where: { mealPlanDay: { profileId, date: toDbDate(day) }, slot: { notIn: keptSlots } } }),
        prisma.mealPlanDay.update({
          where: { profileId_date: { profileId, date: toDbDate(day) } },
          data: { ...targets, items: { create: items } },
        }),
      ];
    }),
  ]);
}

/**
 * Plant heute und alle bereits gespeicherten künftigen Tage des Profils mit dem aktuellen Profil neu
 * (R5E). Eine ausdrückliche Aktion - Profil- und Rezeptspeichern lösen sie nie aus.
 *
 * - Historische Tage (vor `today`) werden weder gelesen noch geändert noch gelöscht.
 * - Heute bleiben bereits geloggte Slots samt ihren Mahlzeiten stehen ("Plan = geplant, Log = gegessen");
 *   nur die übrigen Slots werden neu geplant. Künftige Tage werden vollständig neu geplant.
 * - Neu geplant werden genau die gespeicherten Tage von `today` bis zum Ende des Planungshorizonts
 *   (Sonntag der nächsten Woche, R5F-13); gespeicherte Tage dahinter bleiben unverändert. Fehlende Tage
 *   legt die Neuplanung nicht an (sie entstehen wie bisher beim ersten Lesen, z.B. Dashboard oder /plan).
 * - Abwechslung wie in getOrGenerateWeekPlan: je Woche zählen die bleibenden historischen Tage, die
 *   behaltenen Mahlzeiten von heute und die bereits neu geplanten Tage davor.
 * - Erst wird alles geplant, dann in einer Transaktion ersetzt (replaceEditableDayPlans).
 *
 * `today` ist der Kalendertag des Nutzers, den der Aufrufer einmal bestimmt (`todayForUser`).
 */
export async function regenerateEditableDays(profileId: string, today: CalendarDate): Promise<{ regeneratedDays: CalendarDate[] }> {
  const editableDays = await findStoredEditableDays(profileId, today);
  if (editableDays.length === 0) return { regeneratedDays: [] };

  const loggedSlotsToday = await loadLoggedSlots(profileId, today);
  const planningInputs = await loadDayPlanningInputs(profileId);
  const usageByWeek = new Map<CalendarDate, RecipeUsage>();
  const regeneratedDays: RegeneratedDay[] = [];
  for (const day of editableDays) {
    const weekStart = startOfWeek(day);
    const usage = usageByWeek.get(weekStart) ?? (await loadWeekUsage(profileId, day, today));
    usageByWeek.set(weekStart, usage);

    const keptSlots = day === today ? loggedSlotsToday : [];
    if (keptSlots.length > 0) addUsage(usage, await loadRecipeIdsOfSlots(profileId, day, keptSlots));

    const fullPlan = planDay(planningInputs, day, usage);
    const plan = { ...fullPlan, items: fullPlan.items.filter((item) => !keptSlots.includes(item.slot)) };
    addUsage(usage, plan.items.map((item) => item.recipeId));
    regeneratedDays.push({ day, plan, keptSlots });
  }

  await replaceEditableDayPlans(profileId, today, regeneratedDays);
  return { regeneratedDays: editableDays };
}

/** Rezepte der gespeicherten Mahlzeiten in `slots` an `day` - die behaltenen zählen für die Abwechslung mit. */
async function loadRecipeIdsOfSlots(profileId: string, day: CalendarDate, slots: MealSlot[]): Promise<string[]> {
  const items = await prisma.mealPlanItem.findMany({
    where: { mealPlanDay: { profileId, date: toDbDate(day) }, slot: { in: slots } },
    select: { recipeId: true },
  });
  return items.map((item) => item.recipeId);
}

/** Warum eine Mahlzeit nicht ersetzt wurde (replacePlannedMeal). */
export type MealReplacementError =
  /** Kein Planeintrag mit dieser ID in den Tagesplänen des Profils. */
  | "NOT_FOUND"
  /** Der Tag liegt vor `today` - historische Planung bleibt unverändert. */
  | "HISTORICAL_DAY"
  /** Für Tag und Slot gibt es schon einen Log-Eintrag ("Plan = geplant, Log = gegessen"). */
  | "ALREADY_LOGGED"
  /** Kein anderes Rezept erfüllt die harten Vorgaben des Profils für diesen Slot. */
  | "NO_CANDIDATE"
  /** Der Eintrag wurde seit dem Lesen geändert oder gelöscht (z.B. parallele Neuplanung). */
  | "CHANGED";

export type MealReplacementResult =
  | { ok: true; item: Prisma.MealPlanItemGetPayload<{ include: { recipe: true } }> }
  | { ok: false; error: MealReplacementError };

/** Bricht die Ersetzungs-Transaktion ab, wenn der Slot zwischen Prüfung und Schreiben geloggt wurde. */
class SlotLoggedMeanwhile extends Error {}

/**
 * Ersetzt genau eine geplante Mahlzeit (R5E, R5F-7) durch ein anderes passendes Rezept - ohne den Tag
 * oder die Woche neu zu planen. Alle anderen Einträge, die Tagesziele und Log-Einträge bleiben unverändert.
 *
 * - Nur Einträge aus den Tagesplänen von `profileId`; fremde und unbekannte gelten als nicht gefunden.
 * - Nur heute und künftige Tage (`today` bestimmt der Aufrufer, `todayForUser`); historische nie.
 * - Ist für Tag und Slot schon etwas geloggt, bleibt der Eintrag stehen. Plan und Log gehören wie auf
 *   dem Dashboard und bei der Neuplanung allein über den Slot zusammen (siehe loadLoggedSlots).
 * - Kandidaten: derselbe Pool wie beim Planen (loadRecipeCandidates: Ernährungsform, Allergien,
 *   Vorlieben/Abneigungen nach aktuellem Profil, nur Rezepte für diesen Slot) ohne das bisherige Rezept.
 *   Gewählt wird wie im Planer mit selectRecipeForSlot: Rezepte der übrigen Mahlzeiten des Tages
 *   möglichst nicht doppelt, Wochenverwendung als weicher Abschlag, Variety nur, solange sie die
 *   Treffgenauigkeit nicht um mehr als MAX_VARIETY_ACCURACY_LOSS verschlechtert.
 * - Ziel ist, was die bisherige Mahlzeit beitragen sollte (Snapshot × Portion): Der Tag bleibt so
 *   ausgewogen wie geplant, ohne die übrigen Portionen anzufassen. Die Trainingsrolle (Pre-/Post-Workout)
 *   steckt im Slot und in diesem Ziel. Die neue Portion skaliert computeJointPortionScales auf dieses Ziel.
 * - Snapshot und Portion werden zum neuen Rezept geschrieben; Rezepte selbst ändert nichts.
 *
 * Schreiben und die Log-Prüfung laufen in einer Transaktion: erst die bedingte Änderung (nur wenn der
 * Eintrag noch das gelesene Rezept hat und sein Tag nicht historisch ist), danach die Log-Prüfung; ist
 * der Slot inzwischen geloggt, wird zurückgerollt. Unter SQLite hält die Transaktion ab dem Schreiben
 * die Schreibsperre, ein paralleles Loggen kann also nicht dazwischen committen.
 */
export async function replacePlannedMeal(profileId: string, itemId: string, today: CalendarDate): Promise<MealReplacementResult> {
  const item = await prisma.mealPlanItem.findFirst({
    where: { id: itemId, mealPlanDay: { profileId } },
    include: { recipe: true, mealPlanDay: { select: { date: true, items: { select: { id: true, recipeId: true } } } } },
  });
  if (!item) return { ok: false, error: "NOT_FOUND" };

  const day = fromDbDate(item.mealPlanDay.date);
  if (isHistoricalPlanDay(day, today)) return { ok: false, error: "HISTORICAL_DAY" };
  if ((await loadLoggedSlots(profileId, day)).includes(item.slot)) return { ok: false, error: "ALREADY_LOGGED" };

  const profile = await prisma.profile.findUniqueOrThrow({ where: { id: profileId }, select: PLAN_RELEVANT_PROFILE_SELECT });
  const { candidatesBySlot, likedLabels, dislikedLabels } = await loadRecipeCandidates(profile);
  const candidates = (candidatesBySlot.get(item.slot) ?? []).filter((recipe) => recipe.id !== item.recipeId);

  const planned = recipeAsPlanned(item);
  const target: SlotTarget = {
    slot: item.slot,
    time: item.time,
    kcal: planned.kcal * item.portionMultiplier,
    proteinG: planned.proteinG * item.portionMultiplier,
    carbsG: planned.carbsG * item.portionMultiplier,
    fatG: planned.fatG * item.portionMultiplier,
  };
  const otherRecipeIds = new Set(item.mealPlanDay.items.filter((other) => other.id !== item.id).map((other) => other.recipeId));

  const pick = (weekUsage?: RecipeUsage) => {
    const recipe = selectRecipeForSlot(candidates, target, likedLabels, dislikedLabels, otherRecipeIds, weekUsage);
    if (!recipe) return null;
    const [scale] = computeJointPortionScales(target, [{ recipe, priorScale: computePortionScale(target, recipe) }]);
    return { recipe, scale, deviation: dayMacroDeviation(target, [{ recipe, scale }]) };
  };
  const usage = await loadWeekUsage(profileId, day);
  let picked = pick(usage);
  const plain = pick();
  if (picked && plain && picked.deviation > plain.deviation + MAX_VARIETY_ACCURACY_LOSS) picked = plain;
  if (!picked) return { ok: false, error: "NO_CANDIDATE" };
  const { recipe, scale } = picked;

  try {
    const replaced = await prisma.$transaction(async (tx) => {
      const { count } = await tx.mealPlanItem.updateMany({
        where: { id: item.id, recipeId: item.recipeId, mealPlanDay: { profileId, date: { gte: toDbDate(today) } } },
        data: { recipeId: recipe.id, portionMultiplier: scale, ...recipeSnapshotOf(recipe) },
      });
      if (count === 0) return null;
      const logged = await tx.logEntry.count({ where: { profileId, date: item.mealPlanDay.date, slot: item.slot } });
      if (logged > 0) throw new SlotLoggedMeanwhile();
      return tx.mealPlanItem.findUniqueOrThrow({ where: { id: item.id }, include: { recipe: true } });
    });
    return replaced ? { ok: true, item: replaced } : { ok: false, error: "CHANGED" };
  } catch (error) {
    if (error instanceof SlotLoggedMeanwhile) return { ok: false, error: "ALREADY_LOGGED" };
    throw error;
  }
}
