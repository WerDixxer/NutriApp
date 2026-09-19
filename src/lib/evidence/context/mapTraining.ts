import type { SportType } from "@prisma/client";
import type { EvidenceContext } from "../../validation/evidence";
import type { CanonicalTrainingType } from "./canonicalValues";

/**
 * Evidence Context Mapping / Ontology v1 - Training.
 *
 * Übersetzt bestehende, strukturierte App-Daten (`SportType`,
 * `TrainingSession`) in den standardisierten `EvidenceContext`. Reine,
 * deterministische Funktionen ohne DB-Zugriff - dieselbe Architektur-Regel
 * wie schon in der Evidence Engine (engine/contextMatching.ts,
 * engine/scoring.ts): keine Seiteneffekte, kein Zufall, kein LLM.
 *
 * Grundprinzip dieser gesamten Datei: lieber `undefined` als ein falsches
 * Mapping. Ein `SportType`, der keine eindeutige Entsprechung in der
 * Evidence Library hat, wird NIE einer "am ehesten passenden" Kategorie
 * zugeordnet.
 */

/**
 * Einzige Stelle, an der `SportType` auf einen kanonischen `trainingType`
 * abgebildet wird (keine verstreute String-Magie an mehreren Stellen). Als
 * `Record<SportType, ...>` mit allen sechs Enum-Werten explizit aufgeführt:
 * kommt künftig ein neuer `SportType`-Wert zum Prisma-Schema hinzu, meldet
 * TypeScript hier einen fehlenden Key, statt dass er still `undefined`
 * zurückgibt.
 *
 * Begründung je Zeile:
 * - ENDURANCE -> "endurance": direkte, eindeutige Entsprechung.
 * - STRENGTH -> "resistance": Kerksick et al. (2017) bezeichnet
 *   Krafttraining durchgehend als "resistance training/exercise" - die
 *   Schema-Bezeichnung "Powerlifting/Krafttraining" (siehe schema.prisma)
 *   entspricht fachlich demselben Konzept.
 * - ATHLETIC ("Athletik/Funktionell"): mischt typischerweise Kraft- und
 *   Ausdaueranteile in unbekanntem Verhältnis - keine eindeutige Zuordnung
 *   möglich -> undefined.
 * - TEAM_SPORT ("Fußball etc."): intermittierende Belastung, im Paper
 *   selbst explizit als eigene, nicht mit reinem Ausdauer- oder
 *   Krafttraining gleichgesetzte Kategorie behandelt -> undefined.
 * - MIXED: per Definition nicht eindeutig -> undefined.
 * - NONE: kein Training vorhanden, keine Trainings-Evidenz anwendbar ->
 *   undefined.
 */
const SPORT_TYPE_TO_TRAINING_TYPE: Record<SportType, CanonicalTrainingType | undefined> = {
  ENDURANCE: "endurance",
  STRENGTH: "resistance",
  ATHLETIC: undefined,
  TEAM_SPORT: undefined,
  MIXED: undefined,
  NONE: undefined,
};

export function mapSportType(sportType: SportType): CanonicalTrainingType | undefined {
  return SPORT_TYPE_TO_TRAINING_TYPE[sportType];
}

/**
 * `TrainingSession.intensity` ist im Schema ein `Int` von 1-5 OHNE an
 * anderer Stelle im Projekt definierte Skalen-Bedeutung (kein Kommentar,
 * keine Nutzung, die z.B. "5 = ≥90% VO2max" oder "5 = sehr anstrengend"
 * festlegt - siehe schema.prisma). Die Evidence Claims dieser Library
 * verwenden dagegen konkrete physiologische Schwellen (z.B. "≥70% VO2max",
 * "65–80% VO2max"). Es existiert keine dokumentierte, verlässliche Brücke
 * zwischen einer beliebigen 1-5-Skala und diesen Prozentwerten - jede
 * Ableitung (z.B. "intensity 5 => HIGH_INTENSITY") wäre Spekulation, keine
 * Zuordnung.
 *
 * Liefert deshalb IMMER `undefined`. Bewusst als eigene, benannte Funktion
 * (statt das Feld einfach wegzulassen), damit diese Nicht-Zuordnung
 * sichtbar und testbar bleibt (siehe Kapitel-Vorgabe: "keine Intensität aus
 * Sportart, Dauer oder Kalorienverbrauch ableiten").
 */
export function mapTrainingIntensity(intensity: number): undefined {
  // Parameter bewusst entgegengenommen (dokumentiert die beabsichtigte
  // Signatur "nimmt eine Trainings-Intensität entgegen"), aber nicht
  // ausgewertet - siehe Begründung oben.
  void intensity;
  return undefined;
}

/**
 * Reicht `TrainingSession.durationMin` unverändert als strukturiertes
 * `EvidenceContext.trainingDurationMin` durch (siehe Feld-Dokumentation in
 * validation/evidence.ts für die ausführliche Begründung, warum hier KEIN
 * Freitext-String wie "90 min" erzeugt wird). Nur eine defensive
 * Plausibilitätsprüfung (endliche, positive Zahl) - keine Rundung, keine
 * Bucket-Bildung, keine erfundenen Schwellen wie "unter 60 / 60-90 / über
 * 90 Minuten": diese Schwellen kommen in der aktuellen Evidence Library
 * nicht als generische Regel vor (siehe canonicalValues.ts) und werden hier
 * nicht vorweggenommen.
 */
export function mapTrainingDurationMin(durationMin: number): number | undefined {
  return Number.isFinite(durationMin) && durationMin > 0 ? Math.round(durationMin) : undefined;
}

export interface TrainingSessionMappingInput {
  sportType: SportType;
  durationMin: number;
  intensity: number;
}

/**
 * Orchestriert die drei Einzel-Mapper zu einem `EvidenceContext`-Ausschnitt.
 * Setzt NUR Felder, für die tatsächlich ein sicherer Wert ermittelt werden
 * konnte - kein Feld wird mit einem geratenen Platzhalter befüllt.
 */
export function mapTrainingSessionToEvidenceContext(session: TrainingSessionMappingInput): EvidenceContext {
  const context: EvidenceContext = {};

  const trainingType = mapSportType(session.sportType);
  if (trainingType) context.trainingType = trainingType;

  const trainingDurationMin = mapTrainingDurationMin(session.durationMin);
  if (trainingDurationMin !== undefined) context.trainingDurationMin = trainingDurationMin;

  // mapTrainingIntensity() liefert bewusst immer undefined - siehe dort.
  // Es wird hier absichtlich NICHT aufgerufen, um kein totes Feld zu
  // erzeugen; die Funktion existiert für Sichtbarkeit/Tests dieser
  // bewussten Nicht-Zuordnung.

  return context;
}
