export const ACTIVITY_LABELS: Record<string, string> = {
  SEDENTARY: "Bürojob, kaum Bewegung",
  LIGHT: "Leicht aktiv (1-3x Sport/Woche)",
  MODERATE: "Mäßig aktiv (3-5x Sport/Woche)",
  HIGH: "Sehr aktiv (6-7x Sport/Woche)",
  ATHLETE: "Extrem aktiv (2x täglich / körperliche Arbeit + Sport)",
};

export const GOAL_LABELS: Record<string, string> = {
  LOSE_WEIGHT: "Abnehmen",
  MAINTAIN: "Gewicht halten",
  GAIN_MUSCLE: "Muskeln aufbauen",
  GAIN_WEIGHT: "Zunehmen",
};

export const SPORT_LABELS: Record<string, string> = {
  ENDURANCE: "Ausdauer / Cardio",
  STRENGTH: "Kraftsport / Powerlifting",
  ATHLETIC: "Athletik / Funktionelles Training",
  TEAM_SPORT: "Mannschaftssport (z.B. Fußball)",
  MIXED: "Gemischt",
  NONE: "Kein regelmäßiger Sport",
};

export const DIET_LABELS: Record<string, string> = {
  OMNIVORE: "Alles (Mischkost)",
  VEGETARIAN: "Vegetarisch",
  VEGAN: "Vegan",
  PESCETARIAN: "Pescetarisch",
  KETO: "Keto",
  LOW_CARB: "Low Carb",
  HALAL: "Halal",
  KOSHER: "Koscher",
  PALEO: "Paleo",
};

export const WEEKDAY_LABELS = [
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
  "Sonntag",
];

export const SLOT_LABELS: Record<string, string> = {
  BREAKFAST: "Frühstück",
  LUNCH: "Mittagessen",
  DINNER: "Abendessen",
  SNACK: "Snack",
  PRE_WORKOUT: "Vor dem Training",
  POST_WORKOUT: "Nach dem Training",
};

/** Anzeigenamen der kuratierten Rezept-Tags (recipes/tags.ts). Nur Darstellung; die Tags selbst bleiben die kanonischen Slugs. */
export const RECIPE_TAG_LABELS: Record<string, string> = {
  omnivore: "Mischkost",
  vegetarian: "Vegetarisch",
  vegan: "Vegan",
  pescatarian: "Pescetarisch",
  keto: "Keto",
  "high-protein": "Proteinreich",
  "low-calorie": "Kalorienarm",
  "low-carb": "Low Carb",
  "high-carb": "Kohlenhydratreich",
  "high-fiber": "Ballaststoffreich",
  balanced: "Ausgewogen",
  breakfast: "Frühstück",
  lunch: "Mittagessen",
  dinner: "Abendessen",
  snack: "Snack",
  dessert: "Dessert",
  "pre-workout": "Vor dem Training",
  "post-workout": "Nach dem Training",
  "pre-cardio": "Vor dem Cardio",
  "pre-strength": "Vor dem Krafttraining",
  "pre-football": "Vor dem Fußball",
  "post-cardio": "Nach dem Cardio",
  "post-strength": "Nach dem Krafttraining",
  "post-football": "Nach dem Fußball",
  "training-energy": "Trainingsenergie",
  recovery: "Regeneration",
  quick: "Schnell",
  easy: "Einfach",
  "meal-prep": "Meal Prep",
  "budget-friendly": "Günstig",
};

export const PANTRY_LOCATION_LABELS: Record<string, string> = {
  FRIDGE: "Kühlschrank",
  FREEZER: "Gefrierschrank",
  PANTRY: "Vorratsschrank",
  CUPBOARD: "Küchenschrank",
  OTHER: "Sonstiges",
};

export const EXPIRATION_TYPE_LABELS: Record<string, string> = {
  EXACT: "genau",
  ESTIMATED: "geschätzt",
  UNKNOWN: "unbekannt",
};

export const BUDGET_PERIOD_LABELS: Record<string, string> = {
  WEEK: "Woche",
  MONTH: "Monat",
};

export const FOOD_EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  GROCERIES: "Lebensmitteleinkauf",
  RESTAURANT: "Restaurant",
  TAKEAWAY: "Takeaway/Lieferung",
  OTHER: "Sonstiges",
};

export const BUDGET_STATUS_LABELS: Record<string, string> = {
  UNDER_BUDGET: "Im Rahmen",
  NEAR_LIMIT: "Nähert sich dem Limit",
  OVER_BUDGET: "Über dem Budget",
};

/** Anzeigenamen für die interne Recipe-Review-Queue (Kapitel 19). */
export const REVIEW_CATEGORY_LABELS: Record<string, string> = {
  duplicate_exact: "Exaktes Duplikat",
  duplicate_possible: "Möglicher Duplicate-Kandidat",
  insufficient_data: "Unzureichende Daten",
  quality_issue: "Quality Issue",
  clean: "Sauber",
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  needs_changes: "Needs changes",
  approved: "Approved",
  rejected: "Rejected",
};

export const QUALITY_SEVERITY_LABELS: Record<string, string> = {
  error: "Fehler",
  warning: "Warnung",
  info: "Hinweis",
};

/** Persistente Import-Queue (Kapitel 21), siehe recipes/importWorkflow.ts. */
export const IMPORT_QUEUE_STATUS_LABELS: Record<string, string> = {
  pending_review: "Wartet auf Prüfung",
  needs_changes: "Überarbeitung nötig",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  published: "Veröffentlicht",
  failed: "Publish blockiert",
};

export const IMPORT_EVENT_LABELS: Record<string, string> = {
  imported: "Importiert",
  needs_changes: "Zur Überarbeitung markiert",
  resubmitted: "Erneut zur Prüfung",
  rejected: "Abgelehnt",
  approved: "Freigegeben",
  food_assigned: "Food manuell zugeordnet",
  published: "Im Katalog veröffentlicht",
  publish_blocked: "Publish blockiert",
  publish_error: "Publish fehlgeschlagen",
};

export const IMPORT_DONE_MESSAGES: Record<string, string> = {
  needs_changes: "Als „Überarbeitung nötig“ markiert.",
  resubmitted: "Wieder zur Prüfung gestellt.",
  rejected: "Abgelehnt.",
  approved: "Freigegeben. Das Rezept ist noch NICHT im Katalog – dafür gibt es den separaten Publish.",
  food_assigned: "Food zugeordnet. Validierung, Nährwerte und Duplikate wurden neu berechnet.",
  published: "Im Katalog veröffentlicht.",
};

export const IMPORT_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: "Ungültige Eingabe. Es wurde nichts geändert.",
  NOT_FOUND: "Dieser Import-Kandidat existiert nicht.",
  INVALID_TRANSITION: "Diese Aktion ist im aktuellen Status nicht erlaubt.",
  CONCURRENT_UPDATE: "Der Kandidat wurde inzwischen geändert. Bitte die Seite prüfen und erneut versuchen.",
  NOTE_REQUIRED: "Für eine Ablehnung ist ein Grund nötig.",
  NOT_APPROVABLE: "Freigabe nicht möglich: Die Voraussetzungen sind nicht erfüllt (siehe Freigabe-Prüfung).",
  DUPLICATE_ACKNOWLEDGEMENT_REQUIRED: "Mögliche Duplikate müssen ausdrücklich bestätigt und begründet werden.",
  ASSIGNMENT_NOT_ALLOWED: "Food-Zuordnungen sind nur vor der Freigabe möglich.",
  INGREDIENT_NOT_FOUND: "Diese Zutat gibt es im Kandidaten nicht.",
  INGREDIENT_ALREADY_RESOLVED: "Diese Zutat ist bereits einem Food zugeordnet.",
  FOOD_NOT_FOUND: "Dieses Food gibt es im Katalog nicht. Es wurde nichts geändert.",
  NOT_APPROVED: "Veröffentlichen ist nur für freigegebene Kandidaten möglich.",
  ALREADY_PUBLISHED: "Bereits veröffentlicht. Es wurde kein zweites Rezept erstellt.",
  ALREADY_IN_CATALOG: "Zu dieser Quelle existiert bereits ein Katalog-Rezept. Es wurde kein zweites erstellt.",
  PUBLISH_BLOCKED: "Publish blockiert: Die erneute Prüfung trägt die Freigabe nicht mehr (siehe Verlauf). Es wurde kein Rezept erstellt.",
  PUBLISH_FAILED: "Publish fehlgeschlagen und vollständig zurückgerollt. Es wurde kein Rezept erstellt.",
};

/** Anzeigenamen für den Import-Pipeline-Status (Kapitel 20). "approved"/"rejected" kommen nie aus der Pipeline selbst. */
export const IMPORT_STATUS_LABELS: Record<string, string> = {
  raw: "Roh (unverändert von der Quelle)",
  normalized: "Normalisiert",
  validation_failed: "Validierung fehlgeschlagen",
  ready_for_review: "Bereit zur Prüfung",
  duplicate_review: "Duplicate-Verdacht – Prüfung nötig",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
};
