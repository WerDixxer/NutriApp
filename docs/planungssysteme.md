# Planungssysteme: Tagesplan und Haushalts-Essensplan

VYN hat zwei getrennte Planungssysteme. Sie sind keine zwei Varianten desselben Konzepts: Sie
gehören verschiedenen Besitzern, entstehen unterschiedlich und werden von verschiedenen Funktionen
gelesen. Wer Planungsdaten liest oder ändert, muss zuerst klären, welches der beiden Systeme
gemeint ist (siehe „Regel für Änderungen“ unten).

## Überblick

| | Persönlicher Tagesplan | Haushalts-Essensplan |
|---|---|---|
| Modelle | `MealPlanDay` → `MealPlanItem` | `MealPlan` → `MealPlanMember`, `MealPlanMeal` |
| Gehört zu | einem `Profile` (ein Tag je Profil und Kalendertag, Unique-Index) | einem `Household` |
| Entsteht | automatisch beim ersten Lesen eines Tages | ausdrücklich per `POST /api/meal-plans/generate` (1–14 Tage) |
| Planungsgrundlage | das Profil des Nutzers: Ziele, Training, Ernährungsform, Allergien, Vorlieben | alle ausgewählten Mitglieder (Hard Constraints und Ziele jedes Mitglieds), Vorrat; das Budget wird geladen, wirkt mangels Rezeptpreisen aber noch nicht |
| Lebenszyklus | keiner; heute und Zukunft bearbeitbar, Vergangenheit historisch | `DRAFT` → `ACTIVE` → `ARCHIVED` |
| Code | `src/lib/generateMealPlan.ts`, `planner.ts`, `planDayBoundary.ts`, `planRelevantProfile.ts` | `src/lib/mealPlanner/*` |
| UI / API | Dashboard, `/plan`, `/api/plan`, `/api/plan/regenerate`, `/api/plan/items/[id]/replace` | `/meal-plans`, `/api/meal-plans/**` |

## Persönlicher Tagesplan (`MealPlanDay` → `MealPlanItem`)

- **Daten:** `MealPlanDay` hält Kalendertag und Tagesziele (kcal, Makros), `MealPlanItem` je
  Mahlzeit Slot, Uhrzeit, Rezept, `portionMultiplier` und den Rezept-Snapshot. Slots sind die fünf
  Standardmahlzeiten (zwei davon `SNACK`) und an Trainingstagen `PRE_WORKOUT`/`POST_WORKOUT`.
- **Erzeugung:** `getOrGenerateDayPlan` / `getOrGenerateWeekPlan` erzeugen einen fehlenden Tag beim
  ersten Lesen und speichern ihn; danach bleibt er stabil. Erzeugt wird nur von heute bis Sonntag
  der nächsten Kalenderwoche (`planDayBoundary.ts`). Vergangene Tage werden nie erzeugt oder
  verändert, gespeicherte vergangene und weit entfernte Pläne bleiben lesbar.
- **Grundlage:** ausschließlich die Planer-Sicht des Profils (`PLAN_RELEVANT_PROFILE_SELECT` in
  `planRelevantProfile.ts`). Ändert sich ein Feld daraus und gibt es gespeicherte bearbeitbare Tage,
  fragt die App nach dem Speichern des Profils, ob diese neu geplant werden sollen.
- **Ändern:** nur ausdrücklich, nie still beim Speichern von Profil oder Rezept:
  - `regenerateEditableDays` plant gespeicherte Tage von heute bis Ende des Horizonts neu; heute
    bereits geloggte Slots bleiben stehen.
  - `replacePlannedMeal` ersetzt eine einzelne Mahlzeit (nicht an vergangenen Tagen, nicht in
    geloggten Slots).
- **Gelesen von:**
  - Dashboard (heute) und `/plan` (laufende Woche)
  - Einkaufsliste (`/api/shopping/week`): nur heute und künftige Tage erzeugen Bedarf
  - Insights zu Mahlzeiten (fehlende Zutaten, Ablauf vor der Mahlzeit)
  - Food Assistant („Plan für heute“)
- **Plan und Log:** `MealPlanItem` ist das Geplante, `LogEntry` das tatsächlich Gegessene. Der Log
  ist eine eigenständige Historie am Profil und hängt nicht per Fremdschlüssel am Plan; zugeordnet
  wird nur über Kalendertag und Slot. Neuplanung ändert keine Log-Einträge.

## Haushalts-Essensplan (`MealPlan` → `MealPlanMember` / `MealPlanMeal`)

- **Daten:**
  - `MealPlan` hält Zeitraum, Name und Status.
  - `MealPlanMember` hält fest, für welche Mitglieder der Plan berechnet wurde. Verlässt ein
    Mitglied den Haushalt oder wird sein Konto gelöscht, wird `householdMemberId` `NULL` und steht
    für ein ehemaliges Mitglied; der Plan bleibt vollständig.
  - `MealPlanMeal` hält je Tag und Slot (Frühstück, Mittag, Abend, Snack) Rezept,
    `portionMultiplier`, Begründungen und den Rezept-Snapshot. Eine Mahlzeit gilt für alle
    geplanten Mitglieder (`householdMemberId` ist derzeit immer `NULL`).
- **Erzeugung:** `generateAndSaveMealPlan` (`mealPlanner/generate.ts`): Planungskontext laden →
  deterministisch planen (`plannerEngine.ts`) → validieren (`validatePlan.ts`) → speichern
  (`mealPlanService.ts`). Ein vollständiger Plan wird `ACTIVE`, ein unvollständiger `DRAFT`, ohne
  gültigen Plan wird nichts gespeichert. Ein Plan darf nicht in der Vergangenheit beginnen.
- **Lebenszyklus** (`planLifecycle.ts`, `mealPlanService.ts`):
  - erlaubt sind nur `DRAFT` → `ACTIVE` und `ACTIVE` → `ARCHIVED`
  - wird ein Plan aktiv, werden überschneidende aktive Pläne des Haushalts archiviert (höchstens
    ein aktiver Plan je Tag)
  - ein vollständig vergangener Entwurf kann nicht mehr aktiviert werden
  - löschen lassen sich nur Entwürfe, die heute oder später beginnen; umbenennen geht immer
- **Gelesen von:** `/meal-plans` (Liste und Detail) und Meal Prep
  (`/api/meal-plans/[id]/meal-prep`: Zutaten bündeln, Vorbereitung planen).

## Gemeinsam genutzt

Beide Systeme nutzen dieselben Bausteine, statt sie doppelt zu implementieren:

- Rezepte und Food-Katalog (`src/lib/recipes/`)
- Rezept-Snapshot: `recipeName`, `recipeKcal`, `recipeProteinG`, `recipeCarbsG`, `recipeFatG` je
  Portion des Basisrezepts zum Planungszeitpunkt; die Menge steht nur in `portionMultiplier`.
  Planansichten lesen Name und Nährwerte über `recipeAsPlanned` aus dem Snapshot, Zutaten und
  Zubereitung kommen live aus dem Rezept. Einkaufsliste, Meal Prep und Insights arbeiten bewusst
  mit den aktuellen Zutaten.
- Kalendertage (`calendarDate.ts`): Kalendertag in `Europe/Berlin`, in der DB als UTC-Mitternacht
- Portionsskalierung (`computeJointPortionScales`, Grenzen `PORTION_SCALE_BOUNDS`)
- Allergie-Auflösung (`matchesAllergen`): im Tagesplan über `fitsProfileHardRules`, im
  Haushaltsplan über `checkHardConstraints` je Mitglied
- Ein Rezept, das in einem Plan eines der beiden Systeme steckt, lässt sich nicht löschen
  (Foreign Key `Restrict`, `DELETE /api/recipes` antwortet mit 409).

## Bewusst nicht verbunden

- Dashboard, `/plan`, Einkaufsliste, Insights, Food Assistant und Log arbeiten nur mit Tagesplänen.
  Meal Prep arbeitet nur mit Haushaltsplänen.
- Ein aktiver Haushaltsplan erzeugt oder ändert keine Tagespläne, und ein Tagesplan hat keinen
  Einfluss auf Haushaltspläne. Kein Feld verbindet `MealPlanDay` und `MealPlan`.

## Warum zwei Systeme

- **Besitz:** Ein Tagesplan gehört einer Person, ein Essensplan dem Haushalt.
- **Lebenszyklus:** Tagespläne haben nur die Grenze Vergangenheit/Zukunft, Essenspläne einen
  Status mit festen Übergängen.
- **Zweck:** Der Tagesplan trifft die persönlichen Kalorien- und Makroziele inklusive Training und
  ist mit dem Log verbunden. Der Essensplan plant gemeinsame Mahlzeiten für mehrere Personen mit
  Vorrat, Budget und Meal Prep.
- **Erzeugung und Bearbeitung:** Tage entstehen automatisch beim Lesen und werden neu geplant oder
  einzeln ersetzt. Essenspläne werden ausdrücklich für einen Zeitraum erzeugt, validiert und über
  den Status verwaltet.

Es gibt keinen technischen Zwang, die Systeme zusammenzuführen. Eine Zusammenführung oder eine
Verbindung (z.B. Haushaltspläne in der persönlichen Einkaufsliste) wäre eine bewusste
Produktentscheidung, kein notwendiges Refactoring.

## Regel für Änderungen

Vor jeder Änderung an Planungsdaten oder an einer Funktion, die Pläne liest, klären:

1. **Welches System?** Tagesplan (`MealPlanDay`), Haushaltsplan (`MealPlan`) oder beide. Nicht
   annehmen, dass „der Plan“ eines davon automatisch einschließt. Soll eine Funktion künftig beide
   lesen, ist das eine Produktentscheidung.
2. **Welche fachliche Quelle?** Geplant (Plan) oder gegessen (`LogEntry`); Rezept wie geplant
   (Snapshot) oder aktuell (Live-Rezept).
3. **Welche Tage?** Vergangene Tage sind Historie und werden nie erzeugt oder verändert; automatisch
   erzeugt und neu geplant wird nur bis zum Ende der nächsten Woche.
