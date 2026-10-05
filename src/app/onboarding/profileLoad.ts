import { z } from "zod";
import {
  activityLevelSchema,
  dietTypeSchema,
  goalSchema,
  sexSchema,
  sportTypeSchema,
  trainingSessionSchema,
} from "@/lib/validation/profile";

/**
 * Laden des gespeicherten Profils für das Profil-Formular (R5F-1). Die vier Zustände sind bewusst
 * getrennt: Nur mit einem geladenen Profil ("existing") oder der eindeutigen Antwort "noch kein
 * Profil" ("new") darf gespeichert werden. Während des Ladens oder nach einem Fehler würde ein
 * Speichern die Startwerte des Formulars (z.B. keine Allergien) über das echte Profil schreiben.
 */
export type ProfileLoadState =
  | { status: "loading" }
  | { status: "existing"; profile: LoadedProfile }
  | { status: "new" }
  | { status: "error" };

const labelListSchema = z.array(z.object({ label: z.string() }));

/** Die Felder aus GET /api/profile, die das Formular übernimmt. */
const loadedProfileSchema = z.object({
  age: z.number(),
  sex: sexSchema,
  heightCm: z.number(),
  weightKg: z.number(),
  activityLevel: activityLevelSchema,
  goal: goalSchema,
  goalRateKgPerWeek: z.number(),
  sportType: sportTypeSchema,
  dietType: dietTypeSchema,
  likedFoods: labelListSchema,
  dislikedFoods: labelListSchema,
  allergies: labelListSchema,
  priorities: labelListSchema,
  trainingSessions: z.array(trainingSessionSchema),
});

export type LoadedProfile = z.infer<typeof loadedProfileSchema>;

/** `profile: null` heißt "noch kein Profil"; fehlt das Feld oder passt die Form nicht, ist die Antwort ungültig. */
const profileResponseSchema = z.object({ profile: loadedProfileSchema.nullable() });

/**
 * Lädt das Profil und ordnet das Ergebnis genau einem Zustand zu. Netzwerkfehler, HTTP-Fehler
 * (auch 401), kein JSON und eine unerwartete Antwortform sind alle "error" - nie "new".
 */
export async function loadProfileForForm(fetchProfile: () => Promise<Response> = () => fetch("/api/profile")): Promise<Exclude<ProfileLoadState, { status: "loading" }>> {
  try {
    const res = await fetchProfile();
    if (!res.ok) return { status: "error" };
    const parsed = profileResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { status: "error" };
    return parsed.data.profile === null ? { status: "new" } : { status: "existing", profile: parsed.data.profile };
  } catch {
    return { status: "error" };
  }
}

/** Speichern ist nur erlaubt, wenn feststeht, womit das Formular befüllt ist. */
export function canSaveProfile(state: ProfileLoadState): boolean {
  return state.status === "existing" || state.status === "new";
}
