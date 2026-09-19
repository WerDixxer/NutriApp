/**
 * Evidence Context Mapping / Ontology v1 - kanonisches Vokabular.
 *
 * WICHTIG: Diese Werte sind NICHT frei erfunden, sondern direkt aus den
 * tatsächlich in der Evidence Library vorhandenen `EvidenceClaim`-Feldern
 * abgeleitet (siehe kerksick2017.ts). Das wird durch
 * `canonicalValues.test.ts` automatisch gegen die echten kuratierten Claims
 * geprüft - wenn ein künftiges Paper einen neuen `trainingType`-Wert
 * einführt, schlägt dieser Test fehl, statt dass die Konstante hier
 * unbemerkt veraltet.
 *
 * `CANONICAL_TRAINING_TYPES`: die einzigen zwei `trainingType`-Werte, die in
 * der aktuellen Evidence Library tatsächlich vorkommen (neben `null` für
 * "nicht eingeschränkt"). Absichtlich NICHT die Liste aus der Kapitel-
 * Beispielangabe blind übernommen - "TEAM_SPORT"/"ATHLETIC"/"MIXED" o.ä.
 * kommen in keinem Claim vor und werden daher auch hier nicht als Ziel
 * geführt (siehe mapTraining.ts: solche `SportType`-Werte mappen bewusst
 * auf `undefined`, nicht auf einen erfundenen kanonischen Wert).
 */
export const CANONICAL_TRAINING_TYPES = ["endurance", "resistance"] as const;
export type CanonicalTrainingType = (typeof CANONICAL_TRAINING_TYPES)[number];

/**
 * Die beiden einzigen `MealSlot`-abgeleiteten `timingContext`-Werte, für die
 * eine sichere, direkt verifizierbare Entsprechung in der Evidence Library
 * existiert: `"pre-exercise"` ist der exakte `timingContext`-Wert von
 * `KERK17_CHO_PRE_ENDURANCE`, `"post-exercise"` ist als Teilstring in
 * mehreren Claims enthalten (z.B. `KERK17_CHO_POST_RAPID_REFEED`:
 * "unmittelbar post-exercise bis 4–6h danach"). Andere `MealSlot`-Werte
 * (BREAKFAST/LUNCH/DINNER/SNACK) haben KEINE verifizierbare Entsprechung im
 * aktuellen Freitext-Vokabular der Claims und mappen deshalb bewusst auf
 * `undefined` (siehe mapMealTiming.ts) statt auf einen erfundenen Wert wie
 * "daily_intake", der in keinem Claim tatsächlich vorkäme.
 */
export const CANONICAL_MEAL_TIMING_CONTEXTS = ["pre-exercise", "post-exercise"] as const;
export type CanonicalMealTimingContext = (typeof CANONICAL_MEAL_TIMING_CONTEXTS)[number];
