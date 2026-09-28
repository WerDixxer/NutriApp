# VYN

VYN ist eine Web-App für Ernährungsplanung und Lebensmittelverwaltung, für einzelne Nutzer und
Haushalte. Kernfunktionen:

- Konten mit Login (E-Mail/Passwort) und Haushalte mit Einladungen und Rollen
- Profil mit Zielen, Ernährungsform, Allergien, Vorlieben und Trainingszeiten, daraus Kalorien- und
  Makroziele
- Tagesplan und Wochenansicht (`/plan`, Dashboard), Haushalts-Essenspläne mit Meal Prep
  (`/meal-plans`)
- Rezeptkatalog mit strukturierten Zutaten, Nährwertberechnung, Allergen-Auflösung und
  Personalisierung (`/recipes`), eigene Rezepte, Trend-Rezepte (`/trends`)
- Vorrat (`/pantry`) mit Ablauf-/Rotationslogik, Budget (`/budget`), Wocheneinkauf
- Food Assistant auf Basis eines LLM (`/assistant`, optional)
- Interne Werkzeuge für Rezept-Qualität, Review und einen kontrollierten Rezept-Import
  (`/internal/recipe-review`, siehe unten)

Die Oberfläche ist deutschsprachig.

## Technik im Überblick

| Bereich | Umsetzung |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 |
| Styling | Tailwind CSS 4, framer-motion, lucide-react |
| Datenbank | SQLite über Prisma 6 (`prisma/schema.prisma`) |
| Auth | Auth.js (`next-auth` 5 beta), Credentials-Login, JWT-Sessions |
| Validierung | zod 4 |
| Tests | Vitest 3 (Unit- und Integrationstests), Playwright (E2E, derzeit veraltet) |
| LLM | Anthropic SDK hinter einem Provider-Interface |

Aufbau des Codes:

- `src/app/` – Seiten (Server Components), Client-Komponenten (`*Client.tsx`), API-Routen
  (`src/app/api/**/route.ts`) und Server Actions.
- `src/proxy.ts` – schützt alle nicht öffentlichen Routen (Login-Pflicht). `src/lib/session.ts`
  liefert die Helfer, mit denen Seiten und Routen den angemeldeten Nutzer bzw. Haushalt ermitteln.
- `src/lib/` – Fachlogik, nach Bereichen gegliedert: `recipes/` (Food-Katalog, Allergene,
  Nährwerte, Katalog, Qualität, Review, Import), `mealPlanner/` (Haushaltspläne), `agents/`
  (Decision Engine, Food Assistant, Macro Rescue), `pantry/`, `rotation/`, `shopping/`, `budget/`,
  `household/`, `insights/`, `mealPrep/`, `evidence/`, `providers/`, `validation/` (zod-Schemas).
  Daneben der ältere Tagesplaner `planner.ts` / `generateMealPlan.ts` und die Zielberechnung
  `nutrition.ts`.
- `src/components/` – gemeinsame UI, `src/components/ui/` – Basis-Bausteine.
- `prisma/` – Schema und Seed-Skripte.

## Voraussetzungen

- **Node.js ≥ 20.9.0** (Mindestversion von Next.js 16; Prisma 6 verlangt ≥ 18.18)
- **npm** (das Projekt nutzt `package-lock.json`)
- Git
- Prisma und alle weiteren Werkzeuge kommen als Projekt-Abhängigkeiten mit, es muss nichts global
  installiert werden.
- Optional: ein Anthropic API Key für den Food Assistant; Netzwerkzugriff auf
  `world.openfoodfacts.org` für den Barcode-Lookup.

**Verifiziert** ist der unten beschriebene Ablauf unter **Windows 11 mit PowerShell 5.1,
Node.js 24.19.0 und npm 11.17.0** (frischer Clone, siehe „Stand der Verifikation“). macOS und
Linux sind **nicht getestet**; die Befehle sind plattformunabhängig, abweichende Shell-Syntax ist
jeweils angegeben.

## Setup für die lokale Entwicklung

```bash
# 1. Repository klonen
git clone <repository-url> vyn
cd vyn

# 2. Abhängigkeiten installieren (exakt nach package-lock.json)
npm ci

# 3. .env aus der Vorlage erstellen
cp .env.example .env            # PowerShell: Copy-Item .env.example .env
```

4. **Pflichtwert eintragen:** `AUTH_SECRET` in `.env` setzen. Einen zufälligen Wert erzeugt:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

   Alle anderen Werte der Vorlage funktionieren lokal unverändert. Für den Food Assistant
   zusätzlich `ANTHROPIC_API_KEY` eintragen (optional).

```bash
# 5. Prisma Client generieren (läuft meist schon beim Installieren mit, schadet aber nicht)
npx prisma generate

# 6. Datenbank anlegen: erstellt prisma/dev.db nach dem aktuellen Schema
npx prisma db push

# 7. Seeds (Reihenfolge siehe "Datenbank und Seeds")
npm run db:seed:recipes     # Food-Katalog, Alternativen, 60 Katalogrezepte (wichtig)
npm run db:seed             # 30 ältere Rezepte inkl. Trend-Rezepte für /trends
npm run db:seed:evidence    # optional, Evidence Library (nur Backend)

# 8. Entwicklungsserver starten
npm run dev
```

Die App läuft dann auf <http://localhost:3000>. Nicht angemeldet leitet jede Seite auf `/login` um.
Ein neues Konto entsteht über `/register` (legt dabei einen eigenen Haushalt an), danach führt die
App über `/onboarding` (Profil) zum Dashboard. `/setup-account` ist nur für aus der
Einzelprofil-Zeit migrierte Konten ohne Passwort gedacht.

## Umgebungsvariablen

Die Vorlage ist `.env.example`. Next.js liest `.env`; die **Prisma-CLI liest nur `.env`** (nicht
`.env.local`), deshalb muss mindestens `DATABASE_URL` dort stehen.

**Prüfung beim Start (F-21):** `src/instrumentation.ts` prüft die Variablen beim Start jeder
Serverinstanz mit `src/lib/config/env.ts`. In Produktion (`NODE_ENV=production`, z.B.
`npm run start`) bricht jede fehlende oder ungültige Angabe unten den Start mit einer Liste der
betroffenen Variablen ab (nur Namen, nie Werte). In der Entwicklung gibt es dieselbe Liste nur als
Warnung im Terminal, der Server startet trotzdem. `npm run build` prüft nicht – die
Build-Umgebung braucht keine Secrets.

| Variable | Pflicht | Zweck | Umgebung | Standard |
|---|---|---|---|---|
| `DATABASE_URL` | ja | Datenbankverbindung (SQLite). Relativ zu `prisma/schema.prisma`, `file:./dev.db` ist also `prisma/dev.db`. Muss eine Verbindungs-URL sein (`file:…`, `postgresql://…`). | alle | – (Vorlage: `file:./dev.db`) |
| `AUTH_SECRET` | ja | Signaturschlüssel der Auth.js-Sessions. In Produktion mindestens 32 Zeichen. | alle | – |
| `AUTH_TRUST_HOST` | in Produktion, falls kein `AUTH_URL` | `true` = Auth.js vertraut dem Host-Header (hinter einem vertrauenswürdigen Proxy). Nur `true` ist erlaubt – Auth.js würde auch `false` als „vertrauen“ lesen; zum Abschalten weglassen. Auf Vercel/Cloudflare Pages nicht nötig. In der Entwicklung nicht nötig. | Produktion | – |
| `AUTH_URL` | in Produktion, falls kein `AUTH_TRUST_HOST=true` | Öffentliche Basis-URL der App (`https://…`); macht den Host ebenfalls vertrauenswürdig. | Produktion | – |
| `ANTHROPIC_API_KEY` | in Produktion | Für den Food Assistant (Pflicht, solange `LLM_PROVIDER=anthropic`). In der Entwicklung optional: ohne Key antwortet `/api/assistant` mit 503, der Rest der App ist nicht betroffen. | alle | – |
| `LLM_PROVIDER` | optional | LLM-Anbieter. Einziger unterstützter Wert: `anthropic`. | alle | `anthropic` |
| `LLM_MODEL` | optional | Modell für den Food Assistant. Erlaubt sind nur die Modelle in `SUPPORTED_ANTHROPIC_MODELS` (`src/lib/config/env.ts`); ein anderer Wert (z.B. ein Tippfehler) führt am Assistant zu 503. | alle | `claude-sonnet-5` |
| `NUTRITION_PROVIDER` | optional | Anbieter für den Barcode-Lookup `/api/nutrition/lookup`. Einziger unterstützter Wert: `openfoodfacts` (kein Key, braucht Netzwerk). | alle | `openfoodfacts` |
| `INTERNAL_REVIEW_EMAILS` | für interne Tools | Kommagetrennte E-Mail-Adressen mit Zugriff auf `/internal/*` (Groß-/Kleinschreibung egal), in **jeder** Umgebung. Leer = niemand hat Zugriff. Verhalten siehe „Interne Werkzeuge“. | alle | leer |
| `NODE_ENV` | nein (setzt Next.js) | `development` bei `npm run dev`, `production` bei `npm run build`/`start`. Entscheidet, ob Konfigurationsfehler den Start abbrechen, ob Mock-Rezepte importiert/veröffentlicht werden dürfen, und die Prisma-Logausgabe. | – | von Next.js gesetzt |

Tests brauchen keine eigene Konfiguration: die Integrationstests setzen `DATABASE_URL` selbst auf
temporäre Datenbanken.

## Datenbank und Seeds

- **SQLite**, eine Datei: `prisma/dev.db` (nicht eingecheckt, siehe `.gitignore`).
- **Keine Prisma-Migrationen.** Schema-Änderungen werden mit `npx prisma db push` auf die
  Datenbank übertragen (legt die Datei beim ersten Mal an). Es gibt keine Migrations-Historie.
- Viele Listen (Tags, Allergene, Zutaten als Text) liegen als JSON-Strings in Textspalten.

### Seeds

| Befehl | Skript | Erzeugt | Wiederholbar? |
|---|---|---|---|
| `npm run db:seed:recipes` | `prisma/seedRecipes.ts` | Kuratierter **Food-Katalog** (Foods mit Slug, Nährwerten, Allergenen, Aliasen), Alternativen zwischen Foods, **60 Katalogrezepte** mit strukturierten Zutaten und berechneten Nährwerten | Ja. Aktualisiert über den Slug statt zu duplizieren. **Überschreibt** dabei manuelle Änderungen an diesen Foods/Katalogrezepten und übernimmt vorhandene gleichnamige Foods (z.B. aus dem Vorrat angelegte). |
| `npm run db:seed` | `prisma/seed.ts` | **30 ältere Rezepte** (Freitext-Zutaten), davon 6 **Trend-Rezepte** – die einzige Quelle für `/trends` | Ja. Rezepte, die es als nicht-private Rezepte ohne Slug mit gleichem Namen schon gibt, werden übersprungen. Es wird nichts gelöscht; Duplikate aus früheren Läufen bleiben bestehen. |
| `npm run db:seed:evidence` | `prisma/seedEvidence.ts` | Evidence Library (wissenschaftliche Quellen und Aussagen) | Ja (Upsert über fachliche Schlüssel). Derzeit von keiner Seite genutzt, also optional. |

Reihenfolge: `db:seed:recipes` und `db:seed` sind unabhängig voneinander (keine gemeinsamen
Rezeptnamen), empfohlen ist die Reihenfolge aus dem Setup. `npx prisma db seed` führt nur
`prisma/seed.ts` aus (Einstellung `prisma.seed` in `package.json`).

**Ohne `db:seed:recipes` gibt es keinen Food-Katalog.** Die App startet trotzdem, aber ohne
Fehlermeldung bleiben leer bzw. unvollständig: der Rezeptkatalog `/recipes`, die Auflösung von
Zutaten zu Foods (Allergene, Vorlieben/Abneigungen, Vorrats-Abgleich), Nährwertberechnung,
Personalisierung, Zutatenvorschläge im Onboarding sowie die Qualitäts-/Duplikatprüfung und der
Import unter `/internal/recipe-review`.

### Schema ändern

1. `prisma/schema.prisma` anpassen.
2. **Vorher `prisma/dev.db` sichern**, wenn sie echte Daten enthält.
3. `npx prisma db push` ausführen (generiert den Client mit). Prisma weigert sich, Änderungen mit
   Datenverlust ohne Bestätigung anzuwenden.

**Niemals `--force-reset` oder `--accept-data-loss` (und kein `prisma migrate reset`) auf einer
Datenbank mit echten Daten verwenden** – diese Optionen löschen bzw. verwerfen Daten.

## Tests und Checks

| Befehl | Zweck |
|---|---|
| `npm test` | Alle Vitest-Tests einmal (`src/**/*.test.ts`) |
| `npm run test:watch` | Vitest im Watch-Modus |
| `npx tsc --noEmit` | TypeScript-Prüfung (schreibt `tsconfig.tsbuildinfo`, ist in `.gitignore`) |
| `npm run lint` | ESLint |
| `npm run build` | Produktions-Build (schreibt `.next/`) |

Besonderheiten:

- **`tsc` auf einem frischen Clone:** Next.js erzeugt einige globale Typen (z.B. `LayoutProps`)
  erst unter `.next/types`. Ohne sie meldet `npx tsc --noEmit` den Fehler
  `Cannot find name 'LayoutProps'`. Vorher einmal `npx next typegen` ausführen (oder `npm run dev`
  bzw. `npm run build` gestartet haben).

- Einige Tests sind **Integrationstests gegen echte SQLite-Datenbanken**. Sie legen dafür jeweils
  eine **temporäre Datenbank im Temp-Verzeichnis des Betriebssystems** an (Schema per
  `npx prisma db push`) und löschen sie danach wieder. `prisma/dev.db` wird dabei nie geöffnet;
  der Helfer `src/test/isolatedDatabase.ts` bricht ab, wenn die URL nicht im Temp-Verzeichnis
  liegt. Zusätzlich setzt `vitest.config.ts` `DATABASE_URL` für alle Tests auf einen ungültigen
  Sperrwert: Ein PrismaClient ohne explizite Test-URL scheitert sofort, statt die Datenbank aus
  `.env` zu öffnen. Voraussetzung ist ein generierter Prisma Client.
- Tests des Datenbankverhaltens selbst liegen in `src/test/`: `referentialIntegrity.test.ts`
  (Foreign Keys, heutiges Löschverhalten von Rezepten und Accounts), `concurrentWrites.test.ts`
  (zwei gleichzeitige Requests gegen Unique-Indizes, z.B. Tagesplan, Registrierung, Einladung),
  `legacySeed.test.ts` (Seed). Spätere Migrations- und Seed-Tests gehören ebenfalls dorthin und
  nutzen denselben Helfer.
- `npm run test:e2e` (Playwright, `e2e/`) ist **derzeit veraltet** und kein verlässlicher Test:
  die Erwartungen passen nicht mehr zur aktuellen Login-/Registrierungsseite, der Test läuft gegen
  den Dev-Server mit der echten `prisma/dev.db` und braucht zusätzlich installierte
  Playwright-Browser. Er ist nicht Teil von `npm test`.

## Interne Werkzeuge: Rezept-Review und Import

Die Seiten sind nicht in der Navigation verlinkt, nur per URL erreichbar.

| Route | Zweck | Schreibt Daten? |
|---|---|---|
| `/internal/recipe-review` | Import-Queue (mit Statusfilter) und Qualitäts-/Duplikatprüfung des globalen Katalogs | Nein (Statuswahl der Katalog-Liste ist nur lokal im Browser) |
| `/internal/recipe-review/[id]` | Detail eines Katalogrezepts: Quality Issues, Duplikat-Kandidaten | Nein |
| `/internal/recipe-review/import-preview` | Vorschau der Import-Pipeline anhand fester Mock-Fixtures | **Ja, der Button „In die Import-Queue übernehmen“** legt Import-Kandidaten in der Datenbank an (nur außerhalb von Produktion, siehe unten) |
| `/internal/recipe-review/imports/[id]` | Detail eines Import-Kandidaten mit Review-Aktionen | **Ja:** Überarbeitung nötig, Ablehnen, Freigeben, Food-Zuordnung und **Veröffentlichen**. Veröffentlichen legt ein **echtes Rezept im Katalog der verwendeten Datenbank** an (sichtbar für alle Nutzer). Freigeben allein veröffentlicht nichts. |

Zugang (serverseitig in `requireInternalReviewAccess()` und in jeder Server Action geprüft):

- **Login ist immer Pflicht.**
- Zugriff haben **nur** eingeloggte Nutzer, deren E-Mail in `INTERNAL_REVIEW_EMAILS` steht – in
  **jeder** Umgebung, auch bei `npm run dev` (F-07). Ist die Variable leer, hat niemand Zugriff.
- Für die lokale Entwicklung die eigene Konto-E-Mail eintragen, z.B.
  `INTERNAL_REVIEW_EMAILS=ich@example.com`, und den Dev-Server neu starten.
- Ohne Berechtigung antworten die Seiten mit 404.

Warum nicht „in der Entwicklung für alle offen“: `NODE_ENV=development` sagt nichts darüber, wer
den Server erreicht. `next.config.ts` erlaubt Entwicklungszugriffe über `*.trycloudflare.com`-Tunnel;
ein so geteilter Dev-Server ist öffentlich, und jeder könnte sich registrieren. Mit der Allowlist
bleibt ein geteilter Dev-Server oder eine Preview geschlossen, bis jemand ausdrücklich eingetragen ist.

**Mock-Rezepte in Produktion (F-15):** Bei `NODE_ENV=production` weist der Server Kandidaten aus
der Mock-Quelle (`sourceType = "mock"`) ab – sowohl den Import der Fixtures (die Server Action und
`enqueueImportedRecipe`) als auch das Veröffentlichen (`publishCandidate`), auch bei direktem Aufruf.
Es wird dabei nichts geschrieben. Die Vorschau bleibt zur Diagnose sichtbar, ohne Import-Button. In
Entwicklung und Tests funktioniert der Mock-Ablauf wie bisher.

## Produktion: noch nicht vollständig abgedeckt

Es gibt derzeit **keinen dokumentierten und geprüften Produktionsbetrieb**. Bekannt ist:

- **Keine Prisma-Migrationen:** Schema-Änderungen laufen nur per `db push`; es gibt keine
  reproduzierbare, prüfbare Migrationsfolge für eine produktive Datenbank.
- **SQLite und SQLite-geprägtes Schema:** eine lokale Datei, JSON-Daten als Strings. Ein Wechsel
  auf eine andere Datenbank ist mehr als eine Änderung des `provider`.
- **Kalendertage (F-10):** Tagespläne, Wochenplan, Log und Haushalts-Essenspläne gehören zum
  Kalendertag des Nutzers und hängen nicht mehr von der Serverzeitzone ab
  (`src/lib/calendarDate.ts`, in der DB als UTC-Mitternacht). Eine Zeitzone pro Nutzer gibt es noch
  nicht: VYN nimmt für alle Nutzer `Europe/Berlin` an. Budgetzeiträume und Ablaufdaten im Vorrat
  rechnen weiterhin in der lokalen Zeit des Servers. Vor F-10 gespeicherte Tagespläne und
  Log-Einträge lagen auf Mitternacht Serverzeit; die lokale Entwicklungsdatenbank wurde einmalig
  umgerechnet (Regel: `src/scripts/f10CalendarDateCorrection.test.ts`). Andere Datenbanken mit
  Daten von vor F-10 bräuchten dieselbe Umrechnung.
- **Auth:** `AUTH_SECRET` ist Pflicht; bei Selbst-Hosting außerdem `AUTH_TRUST_HOST` oder
  `AUTH_URL` (siehe Tabelle). Die Registrierung ist offen.
- **Prüfung der Umgebungsvariablen beim Start (F-21):** in Produktion bricht eine fehlende oder
  ungültige Pflichtangabe den Start ab (siehe „Umgebungsvariablen“). Ob Datenbank und
  Anthropic-Key tatsächlich funktionieren, prüft der Start nicht (keine Verbindung, kein API-Aufruf).
- **Food Assistant begrenzt (F-20):** pro Nutzer höchstens 20 Anfragen je Stunde und 100 je
  24 Stunden sowie eine gleichzeitig (sonst 429, beim Limit mit `Retry-After`). Jeder LLM-Aufruf
  hat 30 s Timeout und höchstens 1 Wiederholung. Gespeichert in der Tabelle `AssistantRequest`
  (`src/lib/agents/assistantUsage.ts`); eine bestehende lokale Datenbank braucht dafür einmal
  `npx prisma db push` (fügt nur die Tabelle hinzu). Ein globales Kostenlimit gibt es nicht – das
  bleibt Aufgabe des Monitorings beim API-Anbieter.
- **Interne Tools (F-07):** nur über die Allowlist `INTERNAL_REVIEW_EMAILS`, in jeder Umgebung.
  Es gibt keine E-Mail-Bestätigung: eine gelistete Adresse sollte bereits zum Konto der
  berechtigten Person gehören, sonst könnte sie jemand anderes registrieren.
- **F-13 – veraltete E2E-Tests:** siehe „Tests und Checks“.
- **Mock-Rezepte (F-15):** in Produktion weder importierbar noch veröffentlichbar (siehe „Interne
  Werkzeuge“).

(Die Kennungen F-xx beziehen sich auf den Codebase-Audit aus Chapter 22.)

## Stand der Verifikation

Der Setup-Ablauf oben wurde am 24.09.2026 in einem frischen Clone in einem temporären Verzeichnis
mit eigener Datenbank durchgespielt (Windows 11, PowerShell 5.1, Node.js 24.19.0, npm 11.17.0):
`npm ci`, `.env` aus der Vorlage mit generiertem `AUTH_SECRET`, `npx prisma generate`,
`npx prisma db push`, alle drei Seeds zweimal (ohne Duplikate), `npm test`, `npx next typegen` +
`npx tsc --noEmit`, `npm run lint`, `npm run build` und der Start von `npm run dev` (Login-Seite
erreichbar).

Nicht verifiziert sind macOS/Linux, der Produktionsbetrieb (`npm run start` hinter einem Proxy),
der Food Assistant mit echtem API Key, der Barcode-Lookup gegen Open Food Facts und
`npm run test:e2e`.
