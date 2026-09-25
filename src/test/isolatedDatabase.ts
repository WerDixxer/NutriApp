import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { buildSeedCatalog } from "@/lib/recipes/data/build";

/**
 * Isolierte SQLite-Datenbank für Integrationstests: eine frische Datei im OS-Temp-Verzeichnis,
 * Schema per `prisma db push`. Die echte prisma/dev.db wird nie geöffnet:
 * - `pushSchema` (über `assertIsolatedDatabaseUrl`) und `removeIsolatedDatabase` brechen ab, wenn
 *   Datei bzw. Ordner nicht im Temp-Verzeichnis liegen.
 * - vitest.config.ts setzt `DATABASE_URL` auf einen ungültigen Sperrwert, damit ein PrismaClient,
 *   dem die Test-URL fehlt, sofort scheitert, statt die DATABASE_URL aus .env zu laden.
 *
 * Nutzung im Test:
 * - Nur Datenbank-Semantik prüfen (z.B. src/test/referentialIntegrity.test.ts): eigenen
 *   `new PrismaClient({ datasourceUrl: db.url })` anlegen.
 * - App-Code prüfen, der `@/lib/db` importiert: Ort per `vi.hoisted` anlegen und `@/lib/db` per
 *   `vi.mock` auf einen PrismaClient mit `datasourceUrl: db.url` umlenken (siehe z.B.
 *   src/app/api/profile/route.test.ts).
 * In beiden Fällen: `beforeAll(() => pushSchema(db))`, im `afterAll` zuerst `$disconnect()`, dann
 * `removeIsolatedDatabase(db)` (unter Windows lässt sich eine geöffnete SQLite-Datei nicht löschen).
 *
 * Später (eigener Block): Sobald es Prisma-Migrationen gibt, kommt neben `pushSchema` eine Funktion,
 * die die Migrationen gegen dieselbe isolierte Datenbank ausführt - mit derselben Prüfung durch
 * `assertIsolatedDatabaseUrl`.
 */
export interface IsolatedDatabase {
  dir: string;
  url: string;
}

const DEVELOPMENT_DATABASE_PATH = resolve(process.cwd(), "prisma", "dev.db");

export function createIsolatedDatabaseLocation(prefix: string): IsolatedDatabase {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "test.db").replace(/\\/g, "/")}` };
}

/** Liegt `path` (nach Auflösen von `..`) innerhalb des OS-Temp-Verzeichnisses, nicht darauf selbst? */
function isInsideTempDirectory(path: string): boolean {
  const pathFromTemp = relative(resolve(tmpdir()), resolve(path));
  return pathFromTemp !== "" && !pathFromTemp.startsWith("..") && !isAbsolute(pathFromTemp);
}

function databaseFilePath(url: string): string {
  return resolve(url.slice("file:".length).split("?")[0]);
}

/**
 * Wirft, wenn `url` keine SQLite-Datei im Temp-Verzeichnis ist oder auf prisma/dev.db zeigt.
 * Die zweite Prüfung greift, wenn das Repository selbst im Temp-Verzeichnis liegt (z.B. ein
 * frischer Clone zum Testen des Setups).
 */
export function assertIsolatedDatabaseUrl(url: string): void {
  if (!url.startsWith("file:")) {
    throw new Error(`Testdatenbank muss eine SQLite-Datei sein (file:...): ${url}`);
  }
  const path = databaseFilePath(url);
  if (!isInsideTempDirectory(path)) {
    throw new Error(`Testdatenbank liegt nicht im Temp-Verzeichnis: ${url}`);
  }
  if (path.toLowerCase() === DEVELOPMENT_DATABASE_PATH.toLowerCase()) {
    throw new Error(`Testdatenbank darf nicht prisma/dev.db sein: ${url}`);
  }
}

export function pushSchema(db: IsolatedDatabase): void {
  assertIsolatedDatabaseUrl(db.url);
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" });
  // Hätte die Prisma-CLI die überschriebene DATABASE_URL ignoriert, fehlte hier die Datei.
  if (!existsSync(databaseFilePath(db.url))) {
    throw new Error(`prisma db push hat keine Testdatenbank unter ${db.url} angelegt`);
  }
}

export function removeIsolatedDatabase(db: IsolatedDatabase): void {
  if (!isInsideTempDirectory(db.dir)) {
    throw new Error(`Verzeichnis liegt nicht im Temp-Verzeichnis, wird nicht gelöscht: ${db.dir}`);
  }
  rmSync(db.dir, { recursive: true, force: true });
}

/** Legt die kuratierten Foods der Seed-Daten an (id = slug), damit `loadFoodCatalog()` sie findet. */
export async function seedFoodCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.ingredient.createMany({
    data: buildSeedCatalog()
      .all()
      .map((food) => ({
        id: food.id,
        name: food.name,
        normalizedName: food.name.trim().toLowerCase(),
        slug: food.slug,
        category: food.category,
        dietClass: food.dietClass,
        aliases: JSON.stringify(food.aliases),
        allergens: JSON.stringify(food.allergens),
        negligible: food.negligible ?? false,
        unitGrams: food.unitGrams ? JSON.stringify(food.unitGrams) : null,
        kcalPer100: food.nutrition?.kcal ?? null,
        proteinPer100G: food.nutrition?.proteinG ?? null,
        carbsPer100G: food.nutrition?.carbsG ?? null,
        fatPer100G: food.nutrition?.fatG ?? null,
        fiberPer100G: food.nutrition?.fiberG ?? null,
        sugarPer100G: food.nutrition?.sugarG ?? null,
        saturatedFatPer100G: food.nutrition?.saturatedFatG ?? null,
        sodiumPer100Mg: food.nutrition?.sodiumMg ?? null,
      })),
  });
}
