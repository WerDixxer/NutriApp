import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { assertIsolatedDatabaseUrl, createIsolatedDatabaseLocation, removeIsolatedDatabase } from "./isolatedDatabase";

/**
 * Die Schutzmechanismen der Test-Datenbankhilfe selbst. Kein Test hier öffnet eine Datenbank:
 * `assertIsolatedDatabaseUrl` ist eine reine Pfadprüfung, und der Test der Sperre in
 * vitest.config.ts prüft den Sperrwert, bevor er überhaupt einen Client erzeugt.
 */
const forwardSlashes = (path: string) => path.replace(/\\/g, "/");
const DEVELOPMENT_DATABASE_URL = `file:${forwardSlashes(resolve("prisma", "dev.db"))}`;

describe("assertIsolatedDatabaseUrl", () => {
  it("akzeptiert eine frisch angelegte Testdatenbank im Temp-Verzeichnis", () => {
    const db = createIsolatedDatabaseLocation("vyn-r4a-guard-");
    try {
      expect(() => assertIsolatedDatabaseUrl(db.url)).not.toThrow();
    } finally {
      removeIsolatedDatabase(db);
    }
  });

  it("lehnt prisma/dev.db ab, relativ wie in .env und als absoluter Pfad", () => {
    expect(() => assertIsolatedDatabaseUrl("file:./dev.db")).toThrow("nicht im Temp-Verzeichnis");
    expect(() => assertIsolatedDatabaseUrl(DEVELOPMENT_DATABASE_URL)).toThrow("nicht im Temp-Verzeichnis");
  });

  it("lehnt einen Pfad ab, der nur mit dem Temp-Verzeichnis beginnt, aber per .. herausführt", () => {
    const escapingUrl = `file:${forwardSlashes(tmpdir())}/../../dev.db`;
    expect(() => assertIsolatedDatabaseUrl(escapingUrl)).toThrow("nicht im Temp-Verzeichnis");
  });

  it("lehnt das Temp-Verzeichnis selbst und URLs ohne file: ab", () => {
    expect(() => assertIsolatedDatabaseUrl(`file:${forwardSlashes(tmpdir())}`)).toThrow("nicht im Temp-Verzeichnis");
    expect(() => assertIsolatedDatabaseUrl("postgresql://localhost/vyn")).toThrow("SQLite-Datei");
  });
});

describe("removeIsolatedDatabase", () => {
  it("löscht nichts außerhalb des Temp-Verzeichnisses", () => {
    // Bewusst ein Pfad, den es nicht gibt: Selbst wenn die Prüfung fehlte, würde nichts gelöscht.
    const outsideTemp = { dir: resolve("r4a-gibt-es-nicht"), url: "file:./r4a-gibt-es-nicht/test.db" };
    expect(() => removeIsolatedDatabase(outsideTemp)).toThrow("wird nicht gelöscht");
  });
});

describe("Sperre der Default-Datenbank (vitest.config.ts)", () => {
  it("ein PrismaClient ohne explizite Test-URL kann keine Datenbank öffnen", async () => {
    // Zuerst die Sperre selbst: Fehlt sie, endet der Test hier, bevor ein Client prisma/dev.db öffnen könnte.
    expect(process.env.DATABASE_URL).toMatch(/^vitest-blocked:/);

    const clientWithoutTestUrl = new PrismaClient();
    try {
      await expect(clientWithoutTestUrl.user.count()).rejects.toMatchObject({ name: "PrismaClientInitializationError" });
    } finally {
      await clientWithoutTestUrl.$disconnect();
    }
  });
});
