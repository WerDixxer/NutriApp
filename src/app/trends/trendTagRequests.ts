import { z } from "zod";

/**
 * Laden und Speichern der abonnierten Trend-Tags (R5F-3). Gespeichert wird immer die vollständige
 * Liste. Darum darf nur gespeichert werden, wenn die gespeicherte Liste zuvor wirklich geladen wurde:
 * Nach einem Ladefehler würde ein Klick sonst die echten Tags mit einer fast leeren Liste überschreiben
 * (genau das verhindert GET /api/profile serverseitig, indem es bei unlesbaren Tags scheitert).
 */
export type TrendTagLoadResult = { ok: true; tags: string[] } | { ok: false; message: string };
export type TrendTagSaveResult = { ok: true } | { ok: false; message: string };

export const LOAD_FAILED_MESSAGE =
  "Deine Trend-Auswahl konnte nicht geladen werden. Damit sie nicht überschrieben wird, kannst du sie gerade nicht ändern.";
export const SAVE_FAILED_MESSAGE = "Deine Trend-Auswahl konnte nicht gespeichert werden. Bitte versuche es erneut.";

/** `profile: null` (noch kein Profil) heißt: keine gespeicherten Tags. */
const profileTagsSchema = z.object({ profile: z.object({ subscribedTrendTags: z.array(z.string()) }).nullable() });

export async function loadTrendTags(fetchImpl: typeof fetch = fetch): Promise<TrendTagLoadResult> {
  try {
    const res = await fetchImpl("/api/profile");
    if (!res.ok) return { ok: false, message: LOAD_FAILED_MESSAGE };
    const parsed = profileTagsSchema.safeParse(await res.json());
    if (!parsed.success) return { ok: false, message: LOAD_FAILED_MESSAGE };
    return { ok: true, tags: parsed.data.profile?.subscribedTrendTags ?? [] };
  } catch {
    return { ok: false, message: LOAD_FAILED_MESSAGE };
  }
}

export async function saveTrendTags(tags: string[], fetchImpl: typeof fetch = fetch): Promise<TrendTagSaveResult> {
  try {
    const res = await fetchImpl("/api/profile/trend-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    return res.ok ? { ok: true } : { ok: false, message: SAVE_FAILED_MESSAGE };
  } catch {
    return { ok: false, message: SAVE_FAILED_MESSAGE };
  }
}
