import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenFoodFactsProvider } from "./openFoodFactsProvider";

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      json: async () => body,
    }),
  );
}

describe("OpenFoodFactsProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a found product into per-100g macros", async () => {
    mockFetchOnce({
      code: "3017620422003",
      status: 1,
      product: {
        product_name: "Nutella",
        brands: "Ferrero",
        image_url: "https://example.com/nutella.jpg",
        quantity: "400 g",
        nutriments: {
          "energy-kcal_100g": 539,
          proteins_100g: 6.3,
          carbohydrates_100g: 57.5,
          fat_100g: 30.9,
          fiber_100g: 3.4,
          sugars_100g: 56.3,
          "saturated-fat_100g": 10.6,
          sodium_100g: 0.107,
        },
      },
    });

    const provider = new OpenFoodFactsProvider();
    const product = await provider.lookupBarcode("3017620422003");

    expect(product).not.toBeNull();
    expect(product?.name).toBe("Nutella");
    expect(product?.brand).toBe("Ferrero");
    expect(product?.per100g.kcal).toBe(539);
    expect(product?.per100g.proteinG).toBe(6.3);
    // 0.107 g/100g Natrium -> 107 mg
    expect(product?.per100g.sodiumMg).toBe(107);
  });

  it("returns null when the product is not found (status 0)", async () => {
    mockFetchOnce({ code: "0000000000000", status: 0 });
    const provider = new OpenFoodFactsProvider();
    expect(await provider.lookupBarcode("0000000000000")).toBeNull();
  });

  it("returns null when the HTTP request itself fails", async () => {
    mockFetchOnce({}, false);
    const provider = new OpenFoodFactsProvider();
    expect(await provider.lookupBarcode("123")).toBeNull();
  });

  it("returns null when kcal is missing, never fabricates a 0 kcal fact", async () => {
    mockFetchOnce({
      code: "123",
      status: 1,
      product: { product_name: "Unvollständiges Produkt", nutriments: {} },
    });
    const provider = new OpenFoodFactsProvider();
    expect(await provider.lookupBarcode("123")).toBeNull();
  });

  it("returns null on a malformed/unexpected response shape", async () => {
    mockFetchOnce({ unexpected: "shape" });
    const provider = new OpenFoodFactsProvider();
    expect(await provider.lookupBarcode("123")).toBeNull();
  });
});
