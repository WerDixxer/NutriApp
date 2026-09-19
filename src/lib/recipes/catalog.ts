import type { CatalogEdge, CatalogFood } from "./types";

/**
 * Vergleichsform für Lebensmittelnamen: klein, getrimmt, Umlaute/ß in ihre
 * Ersatzschreibung ("Hähnchen" == "Haehnchen"), mehrfache Leerzeichen
 * zusammengefasst. Beide Seiten (Nutzer-Label UND Food-Name/Alias) laufen
 * durch dieselbe Funktion, daher ist der Vergleich symmetrisch.
 */
export function normalizeFoodLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ");
}

/**
 * Laufzeit-Sicht auf die zentrale Food-Tabelle samt Alternativen. Rein
 * lesend und ohne DB-Zugriff: wird aus den Seed-Daten (Tests, Validierung)
 * oder aus DB-Zeilen (recipeService.ts) aufgebaut.
 *
 * Auflösung eines Nutzer-Labels auf Foods läuft ausschließlich über
 * Name/Alias-Gleichheit (kein Fuzzy-Match, kein Teilstring): "Hähnchen" ist
 * bewusst ein eigener Alias von Hähnchenbrust, statt jedes Wort, das mit
 * "Hähnchen" beginnt, zu treffen.
 */
export class FoodCatalog {
  private readonly byId = new Map<string, CatalogFood>();
  private readonly byLabel = new Map<string, CatalogFood[]>();
  private readonly edgesFrom = new Map<string, CatalogEdge[]>();

  constructor(foods: CatalogFood[], edges: CatalogEdge[]) {
    for (const food of foods) {
      this.byId.set(food.id, food);
      const labels = new Set([food.name, ...food.aliases].map(normalizeFoodLabel));
      for (const label of labels) {
        const list = this.byLabel.get(label) ?? [];
        list.push(food);
        this.byLabel.set(label, list);
      }
    }
    for (const edge of edges) {
      const list = this.edgesFrom.get(edge.fromId) ?? [];
      list.push(edge);
      this.edgesFrom.set(edge.fromId, list);
    }
  }

  get size(): number {
    return this.byId.size;
  }

  get(id: string): CatalogFood | undefined {
    return this.byId.get(id);
  }

  all(): CatalogFood[] {
    return Array.from(this.byId.values());
  }

  /** Alle Foods, die das Nutzer-Label benennt (in der Praxis 0 oder 1, Aliase sind eindeutig gepflegt). */
  resolveLabel(label: string): CatalogFood[] {
    return this.byLabel.get(normalizeFoodLabel(label)) ?? [];
  }

  /** Alle Alternativen, die im Rezept anstelle von `foodId` verwendet werden können. */
  alternativesFor(foodId: string): CatalogEdge[] {
    return this.edgesFrom.get(foodId) ?? [];
  }

  /** Kante `fromId -> toId`, falls gepflegt. */
  edge(fromId: string, toId: string): CatalogEdge | undefined {
    return this.alternativesFor(fromId).find((e) => e.toId === toId);
  }
}
