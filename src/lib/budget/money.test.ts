import { describe, expect, it } from "vitest";
import { centsToEuros, eurosToCents, formatCents } from "./money";

describe("eurosToCents", () => {
  it("rechnet ganze Euro-Beträge korrekt um", () => {
    expect(eurosToCents(60)).toBe(6000);
  });

  it("rechnet Cent-genaue Dezimalbeträge korrekt um", () => {
    expect(eurosToCents(19.87)).toBe(1987);
  });

  it("rundet, statt einen ungerundeten Zwischenwert (typischer Floating-Point-Fallstrick) zu übernehmen", () => {
    expect(eurosToCents(0.1 + 0.2)).toBe(30); // 0.1 + 0.2 === 0.30000000000000004 in JS
  });

  it("rundet auf den nächsten Cent, wenn mehr als 2 Nachkommastellen übergeben werden", () => {
    expect(eurosToCents(1.999)).toBe(200);
    expect(eurosToCents(1.991)).toBe(199);
  });

  it("behandelt 0 korrekt", () => {
    expect(eurosToCents(0)).toBe(0);
  });
});

describe("centsToEuros", () => {
  it("ist die Umkehrung von eurosToCents für glatte Beträge", () => {
    expect(centsToEuros(1987)).toBeCloseTo(19.87, 10);
    expect(centsToEuros(6000)).toBe(60);
  });
});

describe("formatCents", () => {
  it("formatiert einen Betrag als deutsche Euro-Notation", () => {
    expect(formatCents(1987, "EUR")).toBe("19,87 €");
  });

  it("formatiert glatte Beträge mit zwei Nachkommastellen", () => {
    expect(formatCents(6000, "EUR")).toBe("60,00 €");
  });

  it("formatiert 0 korrekt", () => {
    expect(formatCents(0, "EUR")).toBe("0,00 €");
  });

  it("formatiert negative Beträge (z.B. Überschreitung) mit Minuszeichen", () => {
    expect(formatCents(-550, "EUR")).toBe("-5,50 €");
  });

  it("fällt bei unbekannter Währung auf den Code selbst zurück, statt zu erfinden", () => {
    expect(formatCents(1000, "XYZ")).toBe("10,00 XYZ");
  });

  it("verwendet EUR als Default-Währung", () => {
    expect(formatCents(1000)).toBe("10,00 €");
  });
});
