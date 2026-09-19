import { describe, expect, it } from "vitest";
import type { SportType } from "@prisma/client";
import {
  mapSportType,
  mapTrainingDurationMin,
  mapTrainingIntensity,
  mapTrainingSessionToEvidenceContext,
  type TrainingSessionMappingInput,
} from "./mapTraining";

describe("mapSportType: exhaustiv für jeden SportType-Wert", () => {
  const expected: Record<SportType, string | undefined> = {
    ENDURANCE: "endurance",
    STRENGTH: "resistance",
    ATHLETIC: undefined,
    TEAM_SPORT: undefined,
    MIXED: undefined,
    NONE: undefined,
  };

  for (const [sportType, expectedValue] of Object.entries(expected) as [SportType, string | undefined][]) {
    it(`${sportType} -> ${expectedValue ?? "undefined"}`, () => {
      expect(mapSportType(sportType)).toBe(expectedValue);
    });
  }

  it("liefert für mehrdeutige Sportarten (ATHLETIC/TEAM_SPORT/MIXED) explizit undefined, keine geratene Kategorie", () => {
    expect(mapSportType("ATHLETIC")).toBeUndefined();
    expect(mapSportType("TEAM_SPORT")).toBeUndefined();
    expect(mapSportType("MIXED")).toBeUndefined();
  });

  it("liefert für NONE (kein Training) undefined, keinen trainingType", () => {
    expect(mapSportType("NONE")).toBeUndefined();
  });
});

describe("mapTrainingIntensity: immer undefined (keine definierte Skalen-Semantik im Projekt)", () => {
  it("liefert für jeden Wert der 1-5-Skala undefined", () => {
    for (const intensity of [1, 2, 3, 4, 5]) {
      expect(mapTrainingIntensity(intensity)).toBeUndefined();
    }
  });

  it("leitet KEINE Intensität aus einem hohen Skalenwert ab (z.B. 5 wird NICHT zu HIGH)", () => {
    expect(mapTrainingIntensity(5)).toBeUndefined();
  });
});

describe("mapTrainingDurationMin", () => {
  it("reicht eine positive Dauer unverändert durch", () => {
    expect(mapTrainingDurationMin(90)).toBe(90);
    expect(mapTrainingDurationMin(45)).toBe(45);
  });

  it("rundet nicht-ganzzahlige Minutenwerte, bildet aber keine Buckets", () => {
    expect(mapTrainingDurationMin(45.4)).toBe(45);
  });

  it("lehnt 0, negative und nicht-endliche Werte ab (undefined statt falscher Zahl)", () => {
    expect(mapTrainingDurationMin(0)).toBeUndefined();
    expect(mapTrainingDurationMin(-10)).toBeUndefined();
    expect(mapTrainingDurationMin(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(mapTrainingDurationMin(Number.NaN)).toBeUndefined();
  });
});

describe("mapTrainingSessionToEvidenceContext", () => {
  it("setzt trainingType und trainingDurationMin für eine eindeutige Sportart", () => {
    const session: TrainingSessionMappingInput = { sportType: "STRENGTH", durationMin: 45, intensity: 3 };
    const context = mapTrainingSessionToEvidenceContext(session);
    expect(context).toEqual({ trainingType: "resistance", trainingDurationMin: 45 });
  });

  it("lässt trainingType weg, wenn die Sportart mehrdeutig ist (kein Fallback-Wert)", () => {
    const session: TrainingSessionMappingInput = { sportType: "MIXED", durationMin: 60, intensity: 3 };
    const context = mapTrainingSessionToEvidenceContext(session);
    expect(context).not.toHaveProperty("trainingType");
    expect(context.trainingDurationMin).toBe(60);
  });

  it("erzeugt KEIN intensityOrDuration- oder Intensitäts-Feld aus Sportart/Dauer", () => {
    const session: TrainingSessionMappingInput = { sportType: "ENDURANCE", durationMin: 60, intensity: 5 };
    const context = mapTrainingSessionToEvidenceContext(session);
    expect(context).not.toHaveProperty("intensityOrDuration");
    // Running/Endurance + 60 min darf NICHT automatisch zu einer Intensitätsangabe werden:
    expect(Object.keys(context)).not.toContain("intensity");
  });

  it("liefert für NONE einen Kontext ganz ohne trainingType, aber weiterhin mit trainingDurationMin", () => {
    const session: TrainingSessionMappingInput = { sportType: "NONE", durationMin: 30, intensity: 1 };
    const context = mapTrainingSessionToEvidenceContext(session);
    expect(context).toEqual({ trainingDurationMin: 30 });
  });

  it("liefert einen leeren Kontext, wenn weder Sportart noch Dauer verwertbar sind", () => {
    const session: TrainingSessionMappingInput = { sportType: "MIXED", durationMin: 0, intensity: 1 };
    const context = mapTrainingSessionToEvidenceContext(session);
    expect(context).toEqual({});
  });

  it("Determinismus: identischer Input liefert exakt denselben EvidenceContext", () => {
    const session: TrainingSessionMappingInput = { sportType: "STRENGTH", durationMin: 45, intensity: 3 };
    expect(mapTrainingSessionToEvidenceContext(session)).toEqual(mapTrainingSessionToEvidenceContext(session));
  });
});
