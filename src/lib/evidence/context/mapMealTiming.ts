import type { MealSlot } from "@prisma/client";
import type { EvidenceContext } from "../../validation/evidence";
import type { CanonicalMealTimingContext } from "./canonicalValues";

/**
 * Evidence Context Mapping / Ontology v1 - Mahlzeiten-Timing.
 *
 * Nur `PRE_WORKOUT`/`POST_WORKOUT` haben eine über den bestehenden,
 * freitext-basierten `timingContext`-Abgleich (engine/contextMatching.ts)
 * tatsächlich verifizierbare Entsprechung in der Evidence Library (siehe
 * canonicalValues.ts und mapMealTiming.test.ts, das dies gegen die echten
 * kuratierten Claims prüft). `BREAKFAST`/`LUNCH`/`DINNER`/`SNACK` mappen
 * bewusst auf `undefined`: keiner der 15 kuratierten Claims verwendet ein
 * Freitext-Vokabular, das diese vier Slots sicher als "daily_intake" o.ä.
 * identifizieren würde, ohne dass wir diese Kategorie selbst erfinden
 * müssten.
 *
 * `during_exercise`/`rapid_recovery` (aus der Kapitel-Zielvorgabe) sind
 * hier bewusst NICHT abbildbar: es gibt in `MealSlot` keinen Wert für
 * "während des Trainings" oder "dringende Wiederauffüllung", und ein
 * solcher Wert würde nur geraten, nicht aus vorhandenen Daten abgeleitet -
 * siehe Kapitel-Abschlussbericht, offener Punkt.
 */
const MEAL_SLOT_TO_TIMING_CONTEXT: Record<MealSlot, CanonicalMealTimingContext | undefined> = {
  PRE_WORKOUT: "pre-exercise",
  POST_WORKOUT: "post-exercise",
  BREAKFAST: undefined,
  LUNCH: undefined,
  DINNER: undefined,
  SNACK: undefined,
};

export function mapMealSlotToTimingContext(slot: MealSlot): CanonicalMealTimingContext | undefined {
  return MEAL_SLOT_TO_TIMING_CONTEXT[slot];
}

export interface MealLogMappingInput {
  slot: MealSlot;
}

/**
 * Beschreibt AUSSCHLIESSLICH den vorhandenen Zustand ("dieser Log-Eintrag
 * ist als Pre-/Post-Workout-Mahlzeit erfasst") - erzeugt keinerlei
 * Empfehlung ("iss X Minuten vorher"). Für eine minutengenaue zeitliche
 * Nähe (z.B. "Training 18:00, letzte Mahlzeit 14:30") fehlt in den
 * bestehenden Datenmodellen die nötige Grundlage: `TrainingSession` trägt
 * nur `weekday` + `startTime` (wiederkehrender Wochenplan, kein
 * Kalenderdatum), `LogEntry` trägt nur `date` + `slot` (siehe
 * schema.prisma-Kommentar "ohne Uhrzeit relevant" - explizit KEINE Uhrzeit
 * gespeichert). Eine Uhrzeit-Differenz zu berechnen wäre daher nur über
 * eine erfundene Slot->Uhrzeit-Konvention möglich - genau das vermeidet
 * dieses Mapping bewusst (siehe Kapitel-Abschlussbericht, offener Punkt).
 */
export function mapMealLogToEvidenceContext(entry: MealLogMappingInput): EvidenceContext {
  const timingContext = mapMealSlotToTimingContext(entry.slot);
  return timingContext ? { timingContext } : {};
}
