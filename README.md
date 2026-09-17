# NutriCoach

Personalisierte Ernährungsplan-App: Profil (Ziele, Ernährungsform, Allergien, Vorlieben, Trainingszeiten)
→ automatische Kalorien-/Makroberechnung → täglicher Essensplan mit Mahlzeiten-Timing rund ums
Training → Kalorien-Tracker. Enthält eine kuratierte Datenbank aktuell viraler Social-Media-Gerichte
(`/trends`).

## Setup

```bash
npm install
npx prisma db push   # legt die SQLite-DB (prisma/dev.db) gemäß Schema an
npm run db:seed       # befüllt die Rezept-Datenbank
npm run dev
```

App läuft danach auf [http://localhost:3000](http://localhost:3000). Beim ersten Aufruf leitet die
Startseite zu `/onboarding` weiter (Profil anlegen), danach zu `/dashboard`.

## Architektur

- **`prisma/schema.prisma`** — Datenmodell (Profile, Trainingseinheiten, Rezepte, Log-Einträge, Tagespläne).
- **`src/lib/nutrition.ts`** — BMR (Mifflin-St-Jeor), TDEE, Kalorien-/Makroziele je nach Ziel & Sportart.
- **`src/lib/planner.ts`** — verteilt Tagesziele auf Mahlzeiten-Slots (inkl. Pre-/Post-Workout-Timing)
  und wählt passende Rezepte aus (Diät-/Allergie-Filter, Vorlieben-Scoring, Trend-Bonus).
- **`src/lib/generateMealPlan.ts`** — verbindet Profil + Planner + DB, erzeugt und speichert den
  Tagesplan (stabil, kein Neu-Mischen bei jedem Aufruf).
- **`prisma/seed.ts`** — kuratierte Rezept-Datenbank inkl. Trend-Tags (`isTrending`, `trendSource`).

## Aktuelle Limitierungen (bewusste MVP-Scope-Entscheidungen)

- **Single-User, keine Authentifizierung.** Es gibt genau ein Profil pro Datenbank (praktisch für den
  persönlichen Gebrauch). Für echten Multi-User-Betrieb braucht es Login (z.B. NextAuth) und
  `profileId` statt "erstes Profil in der DB".
- **Trend-Datenbank ist manuell kuratiert**, kein Live-Scraping von Instagram/TikTok/YouTube (das wäre
  ToS-widrig und technisch instabil — offene APIs für Content-Discovery gibt es dort nicht). Neue
  Trends müssen aktuell manuell in `prisma/seed.ts` ergänzt werden; eine Redaktions-UI wäre der
  nächste sinnvolle Ausbauschritt.
- **SQLite als Dev-Datenbank.** Für Produktivbetrieb (z.B. Vercel) auf Postgres wechseln
  (`datasource db { provider = "postgresql" }` + `DATABASE_URL` anpassen).
- **Nur 3 Hauptmahlzeiten + optionale Pre-/Post-Workout-Slots**, keine freien Snack-Slots außerhalb
  von Trainingstagen.
