import { describe, expect, it } from "vitest";
import { calendarDateInTimeZone, fromDbDate, toDbDate, type CalendarDate } from "@/lib/calendarDate";

/**
 * Dokumentation der einmaligen F-10-Datenkorrektur (durchgeführt am 25.09.2026 auf prisma/dev.db,
 * Sicherung vorher unter %LOCALAPPDATA%\VYN-Backups\dev.db.vor-F10-Korrektur.20260925-133458.db,
 * SHA-256 D7C97B2E…8A495E01). Das Korrekturskript selbst ist nicht im Repository; festgehalten ist
 * hier die Regel, nach der jeder gespeicherte Wert eingeordnet wurde:
 *
 * - bereits UTC-Mitternacht (neue Semantik)       -> unverändert
 * - exakt Mitternacht Europe/Berlin (alt)         -> UTC-Mitternacht desselben Berliner Kalendertags
 * - exakt 23:59:59.999 Europe/Berlin (alt, nur MealPlan.endDate) -> UTC-Mitternacht dieses Tages
 * - alles andere                                  -> unklar, nicht angefasst
 *
 * Ergebnis damals: MealPlanDay.date 22, LogEntry.date 4, MealPlan.endDate 4 Werte umgerechnet;
 * MealPlan.startDate (4) und MealPlanMeal.date (91) waren bereits korrekt; nichts unklar.
 * Andere Datenbanken mit Tagesplänen oder Log-Einträgen von vor F-10 bräuchten dieselbe Umrechnung.
 */
type CorrectedField = "MealPlanDay.date" | "LogEntry.date" | "MealPlan.startDate" | "MealPlan.endDate" | "MealPlanMeal.date";
type Classification = { status: "current" | "legacy"; day: CalendarDate } | { status: "unclear" };

const LEGACY_SERVER_TIME_ZONE = "Europe/Berlin";

function wallClockTime(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: LEGACY_SERVER_TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(value);
  const part = (type: "hour" | "minute" | "second") => parts.find((p) => p.type === type)?.value;
  return `${part("hour")}:${part("minute")}:${part("second")}`;
}

/** Die Einordnungsregel der Korrektur (siehe Kommentar oben). */
function classifyStoredDate(value: Date, field: CorrectedField): Classification {
  if (value.getTime() % (24 * 60 * 60 * 1000) === 0) return { status: "current", day: fromDbDate(value) };
  const time = wallClockTime(value);
  const endOfDayField = field === "MealPlan.endDate";
  if (!endOfDayField && time === "00:00:00" && value.getUTCMilliseconds() === 0) return { status: "legacy", day: calendarDateInTimeZone(value, LEGACY_SERVER_TIME_ZONE) };
  if (endOfDayField && time === "23:59:59" && value.getUTCMilliseconds() === 999) return { status: "legacy", day: calendarDateInTimeZone(value, LEGACY_SERVER_TIME_ZONE) };
  return { status: "unclear" };
}

/** Der Wert, der nach der Korrektur in der Datenbank steht - die Darstellung aus src/lib/calendarDate.ts. */
function correctedValue(value: Date, field: CorrectedField): string | null {
  const result = classifyStoredDate(value, field);
  return result.status === "unclear" ? null : toDbDate(result.day).toISOString();
}

describe("F-10-Datenkorrektur: Einordnung der gespeicherten Werte", () => {
  it("rechnet die tatsächlich korrigierten Altwerte auf UTC-Mitternacht desselben Kalendertags um", () => {
    // Beispiele aus dem Lauf vom 25.09.2026 (Woche 21.-27.09., Log vom 17.09., Planende 25.09.).
    expect(correctedValue(new Date("2026-09-20T22:00:00.000Z"), "MealPlanDay.date")).toBe("2026-09-21T00:00:00.000Z");
    expect(correctedValue(new Date("2026-09-26T22:00:00.000Z"), "MealPlanDay.date")).toBe("2026-09-27T00:00:00.000Z");
    expect(correctedValue(new Date("2026-09-16T22:00:00.000Z"), "LogEntry.date")).toBe("2026-09-17T00:00:00.000Z");
    expect(correctedValue(new Date("2026-09-25T21:59:59.999Z"), "MealPlan.endDate")).toBe("2026-09-25T00:00:00.000Z");
  });

  it("lässt bereits korrekte Werte (UTC-Mitternacht) unverändert", () => {
    expect(classifyStoredDate(new Date("2026-09-21T00:00:00.000Z"), "MealPlan.startDate")).toEqual({ status: "current", day: "2026-09-21" });
    expect(correctedValue(new Date("2026-09-21T00:00:00.000Z"), "MealPlanMeal.date")).toBe("2026-09-21T00:00:00.000Z");
  });

  it("nutzt in Sommer- und Winterzeit und an den Umstellungstagen den jeweils gültigen Berliner Offset", () => {
    expect(correctedValue(new Date("2026-11-15T23:00:00.000Z"), "LogEntry.date")).toBe("2026-11-16T00:00:00.000Z");
    expect(correctedValue(new Date("2026-10-24T22:00:00.000Z"), "MealPlanDay.date")).toBe("2026-10-25T00:00:00.000Z");
    expect(correctedValue(new Date("2026-10-25T23:00:00.000Z"), "MealPlanDay.date")).toBe("2026-10-26T00:00:00.000Z");
    expect(correctedValue(new Date("2026-03-28T23:00:00.000Z"), "MealPlanDay.date")).toBe("2026-03-29T00:00:00.000Z");
    expect(correctedValue(new Date("2026-12-31T22:59:59.999Z"), "MealPlan.endDate")).toBe("2026-12-31T00:00:00.000Z");
  });

  it("ordnet unklare Werte nicht ein, statt zu raten", () => {
    expect(classifyStoredDate(new Date("2026-09-25T10:15:00.000Z"), "MealPlanDay.date").status).toBe("unclear");
    // Tagesende ist nur für MealPlan.endDate die alte Form, Mitternacht nur für die übrigen Felder.
    expect(classifyStoredDate(new Date("2026-09-23T21:59:59.999Z"), "MealPlanDay.date").status).toBe("unclear");
    expect(classifyStoredDate(new Date("2026-09-24T22:00:00.000Z"), "MealPlan.endDate").status).toBe("unclear");
  });

  it("ist idempotent: ein korrigierter Wert bleibt bei erneuter Einordnung unverändert", () => {
    const corrected = new Date(correctedValue(new Date("2026-09-20T22:00:00.000Z"), "MealPlanDay.date")!);
    expect(correctedValue(corrected, "MealPlanDay.date")).toBe(corrected.toISOString());
  });
});
