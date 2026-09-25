import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Kein Test darf prisma/dev.db erreichen: Ein PrismaClient ohne explizite `datasourceUrl` würde
    // sonst die DATABASE_URL aus .env laden. Der Sperrwert ist keine gültige SQLite-URL, ein solcher
    // Client scheitert sofort (PrismaClientInitializationError). Datenbanktests nutzen stattdessen
    // eine isolierte Temp-Datenbank, siehe src/test/isolatedDatabase.ts.
    env: { DATABASE_URL: "vitest-blocked://tests-verwenden-nur-isolierte-datenbanken" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
