import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createIsolatedDatabaseLocation, pushSchema, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * prisma/seed.ts (`npm run db:seed`) gegen eine isolierte SQLite-Datenbank: das echte Skript läuft
 * als eigener Prozess mit überschriebener DATABASE_URL. `pushSchema` bricht ab, wenn die URL nicht
 * im Temp-Verzeichnis liegt - prisma/dev.db wird nie berührt.
 */
const db = createIsolatedDatabaseLocation("vyn-r3-seed-");
const prisma = new PrismaClient({ datasourceUrl: db.url });
const LEGACY_RECIPES = 30;
const TRENDING_RECIPES = 6;

function runLegacySeed(): string {
  return execSync("npx tsx prisma/seed.ts", { env: { ...process.env, DATABASE_URL: db.url }, stdio: "pipe" }).toString();
}

beforeAll(() => pushSchema(db), 120_000);

afterAll(async () => {
  await prisma.$disconnect();
  removeIsolatedDatabase(db);
});

describe("npm run db:seed (prisma/seed.ts)", () => {
  it("legt beim ersten Lauf die 30 Alt-/Trend-Rezepte an und verdoppelt sie beim zweiten Lauf nicht", async () => {
    const user = await prisma.user.create({ data: { name: "Privat" } });
    const profile = await prisma.profile.create({
      data: { userId: user.id, age: 30, sex: "FEMALE", heightCm: 165, weightKg: 60, activityLevel: "LIGHT", goal: "MAINTAIN", dietType: "OMNIVORE" },
    });
    // Ein privates Rezept mit dem Namen eines Altrezepts darf den Seed nicht verhindern und wird nicht angefasst.
    const privateRecipe = await prisma.recipe.create({
      data: {
        name: "Koreanischer Gurkensalat (Oi Muchim)",
        description: "Meine Version",
        kcal: 100,
        proteinG: 1,
        carbsG: 10,
        fatG: 5,
        prepTimeMin: 5,
        mealSlots: "[]",
        dietTypes: "[]",
        allergens: "[]",
        ingredients: "[]",
        instructions: "[]",
        isCustom: true,
        sourceType: "user",
        ownerProfileId: profile.id,
      },
    });

    const first = runLegacySeed();
    expect(first).toContain(`${LEGACY_RECIPES} Rezepte angelegt, 0 übersprungen`);
    expect(await prisma.recipe.count({ where: { isCustom: false } })).toBe(LEGACY_RECIPES);
    expect(await prisma.recipe.count({ where: { isTrending: true } })).toBe(TRENDING_RECIPES);

    const second = runLegacySeed();
    expect(second).toContain(`0 Rezepte angelegt, ${LEGACY_RECIPES} übersprungen`);
    expect(await prisma.recipe.count({ where: { isCustom: false } })).toBe(LEGACY_RECIPES);
    expect(await prisma.recipe.count({ where: { isTrending: true } })).toBe(TRENDING_RECIPES);

    expect(await prisma.recipe.findUniqueOrThrow({ where: { id: privateRecipe.id } })).toMatchObject({ description: "Meine Version", isCustom: true });
    expect(await prisma.recipe.count()).toBe(LEGACY_RECIPES + 1);
  }, 120_000);
});
