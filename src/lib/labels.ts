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
