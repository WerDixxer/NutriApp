import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";
import { buildSeedCatalog } from "@/lib/recipes/data/build";

/**
 * Isolierte SQLite-Datenbank für Integrationstests: eine frische Datei im OS-Temp-Verzeichnis,
 * Schema per `prisma db push`. Die echte prisma/dev.db wird nie geöffnet - `pushSchema` bricht ab,
 * wenn die URL nicht im Temp-Verzeichnis liegt.
 *
 * Nutzung im Test: Ort per `vi.hoisted` anlegen und `@/lib/db` per `vi.mock` auf einen
 * PrismaClient mit `datasourceUrl: db.url` umlenken (siehe z.B. src/app/api/profile/route.test.ts).
 */
export interface IsolatedDatabase {
  dir: string;
  url: string;
}

export function createIsolatedDatabaseLocation(prefix: string): IsolatedDatabase {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, url: `file:${join(dir, "test.db").replace(/\\/g, "/")}` };
}

export function pushSchema(db: IsolatedDatabase): void {
  const tempRoot = tmpdir().replace(/\\/g, "/").toLowerCase();
  if (!db.url.toLowerCase().startsWith(`file:${tempRoot}`)) {
    throw new Error(`Testdatenbank liegt nicht im Temp-Verzeichnis: ${db.url}`);
  }
  execSync("npx prisma db push --skip-generate", { env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" });
}

export function removeIsolatedDatabase(db: IsolatedDatabase): void {
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
