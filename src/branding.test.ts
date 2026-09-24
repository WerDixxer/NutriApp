import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kapitel 19: Rebranding "Good Order" -> "VYN". Statische Quelltext-Prüfung statt eines vollen
 * Next.js-Renders (layout.tsx ist eine async Server Component mit `auth()`-Aufruf) - reicht aus,
 * um sicherzustellen, dass der alte Name nirgends im aktuellen Quelltext mehr sichtbar auftaucht.
 */
const SRC_ROOT = join(process.cwd(), "src");
const SKIP_DIRS = new Set(["node_modules"]);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP_DIRS.has(entry.name)) return [];
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (/\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) return [full];
    return [];
  });
}

describe("VYN-Branding", () => {
  it("kein Quelltext unter src/ enthält noch 'Good Order' als sichtbaren App-Namen (case-insensitiv)", () => {
    const offenders = walk(SRC_ROOT)
      .filter((file) => file !== import.meta.filename)
      .filter((file) => /good order/i.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(SRC_ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("die zentralen Branding-Stellen (Metadata, Nav, Login/Register/Setup/Invite) zeigen VYN", () => {
    const files = [
      "src/app/layout.tsx",
      "src/components/Nav.tsx",
      "src/app/login/page.tsx",
      "src/app/register/page.tsx",
      "src/app/setup-account/page.tsx",
      "src/app/invite/[token]/page.tsx",
    ];
    for (const file of files) {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      expect(content, file).toMatch(/VYN/);
    }
  });

  it("der Browser-Titel (Metadata.title in layout.tsx) ist exakt 'VYN'", () => {
    const content = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(content).toMatch(/title:\s*"VYN"/);
  });

  it("die App-Beschreibung bleibt inhaltlich erhalten (kein blindes Umbenennen jedes Textes)", () => {
    const content = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(content).toContain("Ernährungs- und Trainings-Coach");
  });
});
