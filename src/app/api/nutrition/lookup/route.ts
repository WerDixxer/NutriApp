import { NextResponse } from "next/server";
import { z } from "zod";
import { getApiUserId } from "@/lib/session";
import { getNutritionProvider, NutritionProviderConfigError } from "@/lib/providers/nutritionProvider";

const querySchema = z.object({
  barcode: z.string().trim().regex(/^\d{4,20}$/, "Barcode muss aus 4-20 Ziffern bestehen."),
});

/**
 * Dünner Foundation-Endpoint, der den NutritionProvider real erreichbar
 * macht. Die eigentliche Anbindung an Pantry/Log (Barcode Scanner, Kapitel
 * 17) folgt später, hier geht es nur darum, dass der Provider funktioniert.
 */
export async function GET(request: Request) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse({ barcode: searchParams.get("barcode") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ungültiger Barcode." }, { status: 400 });
  }

  try {
    const product = await getNutritionProvider().lookupBarcode(parsed.data.barcode);
    if (!product) {
      return NextResponse.json({ error: "Produkt nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (err) {
    if (err instanceof NutritionProviderConfigError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    console.error("Nutrition provider error:", err);
    return NextResponse.json({ error: "Nährwert-Lookup gerade nicht verfügbar." }, { status: 502 });
  }
}
