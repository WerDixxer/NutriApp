import { z } from "zod";
import type { NutritionProvider, NutritionProviderProduct } from "./nutritionProvider";

const BASE_URL = "https://world.openfoodfacts.org/api/v2/product";
// Open Food Facts bittet API-Nutzer ausdrücklich um einen aussagekräftigen
// User-Agent (https://openfoodfacts.github.io/openfoodfacts-server/api/), um
// Clients bei Problemen zuordnen zu können.
const USER_AGENT = "GoodOrder/1.0 (persoenliche Ernaehrungsapp, dev)";

/** Nur die Felder, die wir tatsächlich verwenden. Alles andere lassen wir zod ignorieren. */
const nutrimentsSchema = z
  .object({
    "energy-kcal_100g": z.number().optional(),
    proteins_100g: z.number().optional(),
    carbohydrates_100g: z.number().optional(),
    fat_100g: z.number().optional(),
    fiber_100g: z.number().optional(),
    sugars_100g: z.number().optional(),
    "saturated-fat_100g": z.number().optional(),
    sodium_100g: z.number().optional(),
  })
  .partial();

const productSchema = z.object({
  product_name: z.string().optional(),
  brands: z.string().optional(),
  image_url: z.string().optional(),
  quantity: z.string().optional(),
  nutriments: nutrimentsSchema.optional(),
});

const responseSchema = z.object({
  code: z.string(),
  status: z.number(),
  product: productSchema.optional(),
});

function toProduct(barcode: string, raw: z.infer<typeof productSchema>): NutritionProviderProduct | null {
  const n = raw.nutriments;
  // Ohne kcal ist der Datensatz für uns nicht nutzbar, das würde stillschweigend
  // 0 kcal als "Fakt" vortäuschen (widerspricht dem Nutrition-Engine-Prinzip).
  if (!n || typeof n["energy-kcal_100g"] !== "number") return null;

  return {
    source: "openfoodfacts",
    barcode,
    name: raw.product_name?.trim() || "Unbekanntes Produkt",
    brand: raw.brands?.trim() || undefined,
    imageUrl: raw.image_url || undefined,
    servingSize: raw.quantity || undefined,
    per100g: {
      kcal: n["energy-kcal_100g"],
      proteinG: n.proteins_100g ?? 0,
      carbsG: n.carbohydrates_100g ?? 0,
      fatG: n.fat_100g ?? 0,
      fiberG: n.fiber_100g,
      sugarG: n.sugars_100g,
      saturatedFatG: n["saturated-fat_100g"],
      sodiumMg: typeof n.sodium_100g === "number" ? Math.round(n.sodium_100g * 1000) : undefined,
    },
  };
}

export class OpenFoodFactsProvider implements NutritionProvider {
  readonly name = "openfoodfacts";

  async lookupBarcode(barcode: string): Promise<NutritionProviderProduct | null> {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;

    const json = await res.json();
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== 1 || !parsed.data.product) return null;

    return toProduct(barcode, parsed.data.product);
  }
}
