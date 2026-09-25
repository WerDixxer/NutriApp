import { z } from "zod";
import { parseCalendarDate, type CalendarDate } from "../calendarDate";

/** Ein Kalendertag "JJJJ-MM-TT" aus einer Anfrage (siehe src/lib/calendarDate.ts), kein Zeitpunkt. */
export const calendarDateSchema = z.string().transform((value, ctx): CalendarDate => {
  const date = parseCalendarDate(value);
  if (!date) {
    ctx.addIssue({ code: "custom", message: "Datum muss ein gültiges Datum im Format JJJJ-MM-TT sein." });
    return z.NEVER;
  }
  return date;
});
