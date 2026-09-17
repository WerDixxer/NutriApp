import { z } from "zod";

export const assistantMessageSchema = z.object({
  message: z.string().trim().min(1, "Nachricht fehlt.").max(2000, "Nachricht ist zu lang."),
});
