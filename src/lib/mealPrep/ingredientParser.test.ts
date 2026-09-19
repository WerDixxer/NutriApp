import { describe, expect, it } from "vitest";
import { normalizeIngredientKey, parseIngredientLine } from "./ingredientParser";

describe("parseIngredientLine: erkennt echte, unzweideutige Mengenangaben", () => {
  it("Zahl + Leerzeichen + g + Name", () => {
    expect(parseIngredientLine("200 g Hähnchenbrust")).toEqual({ raw: "200 g Hähnchenbrust", quantity: 200, unit: "G", name: "Hähnchenbrust" });
  });

  it("Zahl direkt an g angehängt (keine Leerzeichen)", () => {
    expect(parseIngredientLine("200g Hähnchenbrust")).toEqual({ raw: "200g Hähnchenbrust", quantity: 200, unit: "G", name: "Hähnchenbrust" });
  });

  it("ml-Einheit mit Klammerzusatz im Namen", () => {
    const result = parseIngredientLine("250 ml Milch (oder Pflanzendrink)");
    expect(result?.quantity).toBe(250);
    expect(result?.unit).toBe("ML");
    expect(result?.name).toBe("Milch (oder Pflanzendrink)");
  });

  it("kg-Einheit", () => {
    expect(parseIngredientLine("1 kg Reis")?.unit).toBe("KG");
  });

  it("l-Einheit", () => {
    expect(parseIngredientLine("2 l Wasser")?.unit).toBe("L");
  });

  it("Dezimalzahl mit Komma", () => {
    expect(parseIngredientLine("1,5 kg Kartoffeln")?.quantity).toBe(1.5);
  });

  it("Dezimalzahl mit Punkt", () => {
    expect(parseIngredientLine("0.5 l Milch")?.quantity).toBe(0.5);
  });

  it("Name mit Kommazusatz bleibt in `name` erhalten (Normalisierung passiert erst in normalizeIngredientKey)", () => {
    expect(parseIngredientLine("80 g Erdbeeren, geviertelt")?.name).toBe("Erdbeeren, geviertelt");
  });

  it("ausgeschriebene Einheit 'Gramm'/'Liter'", () => {
    expect(parseIngredientLine("500 Gramm Mehl")?.unit).toBe("G");
    expect(parseIngredientLine("1 Liter Brühe")?.unit).toBe("L");
  });
});

describe("parseIngredientLine: lehnt uneindeutige Zeilen ab, statt zu raten (reale Rezeptdaten)", () => {
  it("Stückzahl ohne erkannte Einheit ('2 Salatgurken')", () => {
    expect(parseIngredientLine("2 Salatgurken")).toBeNull();
  });

  it("Löffelmaße (TL/EL) sind keine PantryUnit, kein Rateergebnis", () => {
    expect(parseIngredientLine("1 TL Salz")).toBeNull();
    expect(parseIngredientLine("2 EL Sesamöl")).toBeNull();
    expect(parseIngredientLine("3 EL Erdnussbutter")).toBeNull();
  });

  it("Bereichsangabe ('1-2 TL Chiliflocken')", () => {
    expect(parseIngredientLine("1-2 TL Chiliflocken (Gochugaru)")).toBeNull();
  });

  it("Bruchangabe ('1/2 Salatgurke')", () => {
    expect(parseIngredientLine("1/2 Salatgurke, in Streifen")).toBeNull();
  });

  it("unbekanntes Mengenwort ('Prise', 'Blatt', 'Handvoll')", () => {
    expect(parseIngredientLine("1 Prise Zimt")).toBeNull();
    expect(parseIngredientLine("8 Blatt Reispapier")).toBeNull();
    expect(parseIngredientLine("1 Handvoll Basilikum")).toBeNull();
  });

  it("keine Zahl am Anfang ('Salz, Pfeffer')", () => {
    expect(parseIngredientLine("Salz, Pfeffer")).toBeNull();
  });

  it("Zahl ohne jede Einheit oder Namen danach ('3 Eier')", () => {
    expect(parseIngredientLine("3 Eier")).toBeNull();
  });

  it("leere Zeile", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("   ")).toBeNull();
  });

  it("Zahl 0 oder negativ wird nie akzeptiert", () => {
    expect(parseIngredientLine("0 g Salz")).toBeNull();
  });
});

describe("normalizeIngredientKey: schmale, sichere Normalisierung", () => {
  it("Kleinschreibung", () => {
    expect(normalizeIngredientKey("Hähnchenbrust")).toBe("hähnchenbrust");
  });

  it("entfernt einen abschließenden Kommazusatz", () => {
    expect(normalizeIngredientKey("Erdbeeren, geviertelt")).toBe("erdbeeren");
  });

  it("entfernt einen Klammerzusatz", () => {
    expect(normalizeIngredientKey("Milch (oder Pflanzendrink)")).toBe("milch");
  });

  it("führt dieselbe Zutat mit/ohne Zubereitungshinweis zusammen", () => {
    expect(normalizeIngredientKey("Karotte, geraspelt")).toBe(normalizeIngredientKey("Karotte"));
  });

  it("führt NIEMALS unterschiedliche Grundzutaten fälschlich zusammen (kein Fuzzy-Matching)", () => {
    expect(normalizeIngredientKey("Hähnchenbrust")).not.toBe(normalizeIngredientKey("Hähnchenbrühe"));
    expect(normalizeIngredientKey("Chicken breast")).not.toBe(normalizeIngredientKey("Chicken broth"));
  });
});
