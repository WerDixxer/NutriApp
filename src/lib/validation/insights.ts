import { z } from "zod";

export const dismissInsightSchema = z.object({
  insightKey: z.string().min(1).max(200),
});

export type DismissInsightInput = z.infer<typeof dismissInsightSchema>;
