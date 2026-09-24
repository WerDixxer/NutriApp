/**
 * Reine Logik hinter dem TagInput (Chips für Präferenzen). Ohne React, damit
 * sie ohne Komponenten-Rendering testbar ist.
 */

export interface TagSuggestion {
  /** Wert, der als Tag gespeichert wird (kanonischer Name). */
  label: string;
  /** Kurzer Hinweis, worüber der Treffer gefunden wurde ("Nudeln" bei Pasta). */
  hint?: string;
}

/** Hängt einen Wert an; leere und bereits vorhandene Werte ändern nichts (gleiche Liste zurück). */
export function addTag(values: string[], raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || values.includes(trimmed)) return values;
  return [...values, trimmed];
}

/**
 * Was Enter (oder ein Klick) speichert: der aktive Vorschlag mit seinem
 * kanonischen Namen, sonst der eingegebene Freitext unverändert.
 */
export function tagToCommit(draft: string, suggestions: TagSuggestion[], activeIndex: number): string {
  const active = suggestions[activeIndex];
  return active ? active.label : draft.trim();
}

/**
 * Mausklick auf einen Vorschlag: übernimmt dessen kanonischen Namen, genau wie Enter.
 *
 * `preventDefault` ist Pflicht: Die Felder liegen in einem `<label>`. Ein Klick auf ein
 * nicht interaktives Element darin löst nach den Click-Handlern die Label-Aktivierung
 * aus, also einen zweiten Klick auf das erste bedienbare Element im Label. Nach dem
 * Übernehmen ist das der X-Button des Chips (bei vorhandenen Chips der des ersten), und
 * der neue Tag wäre sofort wieder entfernt.
 */
export function selectSuggestion(event: { preventDefault(): void }, values: string[], suggestion: TagSuggestion): string[] {
  event.preventDefault();
  return addTag(values, suggestion.label);
}

/**
 * Klick irgendwo im Feld. Liegt das Feld in einem `<label>` (wie in OnboardingForm),
 * löst ein Klick auf eine nicht bedienbare Fläche (leerer Bereich, Chip-Text) die
 * Label-Aktivierung aus: ein zweiter Klick auf das erste bedienbare Element im Label,
 * und das ist der X-Button des ersten Chips. Der Chip würde ohne Zutun des Nutzers gelöscht.
 *
 * Deshalb wird die Aktivierung dort abgebrochen; der Aufrufer fokussiert stattdessen den
 * Input selbst (`true`). Klicks auf Buttons (X eines Chips) und auf den Input bleiben
 * unberührt (`false`): sie sind selbst bedienbar, lösen keine Label-Aktivierung aus und
 * behalten ihr normales Verhalten.
 */
export function redirectFieldClickToInput(event: { preventDefault(): void; target: unknown }): boolean {
  const target = event.target as { closest?: (selector: string) => unknown } | null;
  if (target?.closest?.("button, input")) return false;
  event.preventDefault();
  return true;
}

/** Nächster aktiver Index beim Pfeiltasten-Wechsel; -1 = kein Vorschlag aktiv (Freitext). Läuft nicht im Kreis. */
export function moveActive(activeIndex: number, count: number, direction: 1 | -1): number {
  if (count === 0) return -1;
  const next = activeIndex + direction;
  return Math.min(count - 1, Math.max(0, next));
}
