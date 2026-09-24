import { describe, expect, it, vi } from "vitest";
import { addTag, moveActive, selectSuggestion, tagToCommit } from "../tagInput";
import { resolveAllergyLabels, suggestAllergens } from "./allergens";
import { buildSeedCatalog } from "./data/build";
import { suggestFoods } from "./foodSuggestions";
import { resolvePreferences } from "./personalization";

const catalog = buildSeedCatalog();
const foods = catalog.all();

const labels = (query: string, exclude: string[] = []) => suggestFoods(foods, query, { exclude }).map((s) => s.label);

describe("Food-Vorschläge aus dem FoodCatalog", () => {
  it("'Hähn' findet Hähnchenbrust", () => {
    expect(labels("Hähn")).toContain("Hähnchenbrust");
  });

  it("'Haehn' (ohne Umlaut) findet dasselbe", () => {
    expect(labels("Haehn")).toContain("Hähnchenbrust");
  });

  it("'Magerqu' findet Magerquark als ersten Treffer", () => {
    expect(labels("Magerqu")[0]).toBe("Magerquark");
  });

  it("'Frisch' findet Frischkäse und Frischkäse light als getrennte Foods", () => {
    expect(labels("Frisch")).toEqual(expect.arrayContaining(["Frischkäse", "Frischkäse light"]));
  });

  it("'Pap' findet Paprika", () => {
    expect(labels("Pap")).toContain("Paprika");
  });

  it("'Erdn' findet Erdnussbutter (das einzige Erdnuss-Food des Katalogs)", () => {
    expect(labels("Erdn")).toContain("Erdnussbutter");
  });

  it("ein Alias findet das kanonische Food und nennt den Alias als Hinweis: 'Nud' -> Pasta (Nudeln)", () => {
    const [first] = suggestFoods(foods, "Nud");
    expect(first).toMatchObject({ label: "Pasta", foodId: "pasta", hint: "nudeln" });
  });

  it("weitere Alias-Eingaben landen beim kanonischen Namen ('Hühnch', 'Spag')", () => {
    expect(labels("Hühnch")).toContain("Hähnchenbrust");
    expect(labels("Spag")).toContain("Pasta");
  });

  it("ein Treffer über den Namen trägt keinen Alias-Hinweis", () => {
    expect(suggestFoods(foods, "Paprika")[0].hint).toBeUndefined();
  });

  it("jedes vorgeschlagene Label löst über resolveLabel wieder auf genau dieses Food auf", () => {
    for (const query of ["Hähn", "Magerqu", "Frisch", "Pap", "Nud", "Erdn", "Reis", "Ha"]) {
      for (const suggestion of suggestFoods(foods, query)) {
        expect(catalog.resolveLabel(suggestion.label).map((f) => f.id)).toContain(suggestion.foodId);
      }
    }
  });

  it("zu kurze Eingaben erzeugen keine Vorschläge", () => {
    expect(suggestFoods(foods, "")).toEqual([]);
    expect(suggestFoods(foods, " ")).toEqual([]);
    expect(suggestFoods(foods, "H")).toEqual([]);
  });

  it("begrenzt die Anzahl und schließt bereits gewählte Foods aus", () => {
    expect(suggestFoods(foods, "Ha", { limit: 3 }).length).toBeLessThanOrEqual(3);
    expect(labels("Hähn", ["Hähnchenbrust"])).not.toContain("Hähnchenbrust");
  });

  it("findet nur Wort- oder Namensanfänge, keine Treffer aus der Wortmitte", () => {
    // "quark" steckt in "Magerquark" mitten im Wort; "Ma" darf ihn nur über den Namensanfang finden.
    expect(labels("uark")).toEqual([]);
    expect(labels("nchen")).toEqual([]);
  });

  it("Wörter mitten in einer Alias-Beschreibung erzeugen keine Zufallstreffer ('Ei' findet keinen Limettensaft)", () => {
    const found = labels("Ei");
    expect(found).toContain("Ei");
    expect(found).not.toContain("Limettensaft");
    expect(found).not.toContain("Thunfisch");
  });

  it.each(["Rosenkohl", "Blumenkohl", "Algen", "Trüffel", "Maultaschen"])("unbekannter Begriff '%s' bekommt keinen Food-Vorschlag", (term) => {
    expect(suggestFoods(foods, term)).toEqual([]);
    // Vollständig getippte, aber unbekannte Begriffe lösen sich auch nicht im Katalog auf.
    expect(catalog.resolveLabel(term)).toEqual([]);
  });
});

describe("Allergie-Vorschläge aus dem Allergen-Vokabular", () => {
  const allergyLabels = (query: string, exclude: string[] = []) => suggestAllergens(query, { exclude }).map((s) => s.label);

  it("'Erdn' findet Erdnuss als ersten Treffer", () => {
    expect(allergyLabels("Erdn")[0]).toBe("Erdnuss");
  });

  it("'Erdnüsse' (Plural) findet ebenfalls Erdnuss", () => {
    expect(allergyLabels("Erdnüsse")).toEqual(["Erdnuss"]);
  });

  it("Synonyme führen zum kanonischen Eintrag: 'Lakt' -> Milch (Hinweis laktose)", () => {
    expect(suggestAllergens("Lakt")[0]).toEqual({ label: "Milch", hint: "laktose" });
  });

  it("konkrete Baumnüsse führen zu 'Baumnüsse', nicht zum Oberbegriff 'Nüsse'", () => {
    expect(allergyLabels("Walnu")).toEqual(["Baumnüsse"]);
  });

  it("jeder Vorschlag löst über resolveAllergyLabels auf sein Allergen auf", () => {
    for (const query of ["Erdn", "Lakt", "Walnu", "Nu", "Glu", "Soj", "Ei", "Fis", "Ses", "Schal", "Krebs"]) {
      for (const suggestion of suggestAllergens(query)) {
        const resolved = resolveAllergyLabels([suggestion.label]);
        expect(resolved.unresolvedTerms).toEqual([]);
        expect(resolved.allergens.size).toBeGreaterThan(0);
      }
    }
  });

  it("die gespeicherte Auswahl 'Erdnuss' sperrt dasselbe wie die frühere Eingabe 'Erdnüsse'", () => {
    expect([...resolveAllergyLabels(["Erdnuss"]).allergens]).toEqual([...resolveAllergyLabels(["Erdnüsse"]).allergens]);
  });

  it("'Nüsse' als Oberbegriff sperrt weiterhin auch Erdnuss (Sicherheitsverhalten unverändert)", () => {
    expect([...resolveAllergyLabels(["Nüsse"]).allergens].sort()).toEqual(["erdnuss", "nüsse"]);
  });

  it.each(["Sellerie", "Senf", "Rosenkohl", "Trüffel"])("'%s' steht nicht im Vokabular und bekommt keinen künstlichen Treffer", (term) => {
    expect(suggestAllergens(term)).toEqual([]);
  });

  it("zu kurze Eingaben und bereits gewählte Allergene erzeugen keinen Vorschlag", () => {
    expect(suggestAllergens("E")).toEqual([]);
    expect(allergyLabels("Erdn", ["Erdnuss"])).toEqual([]);
  });
});

describe("Auswahl und Freitext im TagInput", () => {
  it("Auswahl eines Vorschlags speichert den kanonischen Namen, nicht den getippten Text", () => {
    const suggestions = suggestFoods(foods, "Nud");
    expect(tagToCommit("Nud", suggestions, 0)).toBe("Pasta");
    expect(addTag([], tagToCommit("Nud", suggestions, 0))).toEqual(["Pasta"]);
  });

  it("der gespeicherte kanonische Wert löst über die bestehende Präferenz-Auflösung auf das Food auf", () => {
    const stored = tagToCommit("Magerqu", suggestFoods(foods, "Magerqu"), 0);
    const { favorites } = resolvePreferences({ favoriteFoods: [stored], dislikedFoods: [] }, catalog);
    expect(favorites[0].foodIds).toEqual(["magerquark"]);
  });

  it("Freitext ohne aktiven Vorschlag wird unverändert (nur getrimmt) gespeichert", () => {
    expect(tagToCommit("  Rosenkohl ", [], -1)).toBe("Rosenkohl");
    expect(tagToCommit("Rosenkohl", suggestFoods(foods, "Rosenkohl"), 0)).toBe("Rosenkohl");
    expect(addTag(["Reis"], "Trüffel")).toEqual(["Reis", "Trüffel"]);
  });

  it("Freitext lässt sich auch bei vorhandenen Vorschlägen speichern (kein aktiver Eintrag)", () => {
    expect(tagToCommit("Nud", suggestFoods(foods, "Nud"), -1)).toBe("Nud");
  });

  it("leere und doppelte Werte werden nicht angehängt", () => {
    const values = ["Pasta"];
    expect(addTag(values, "  ")).toBe(values);
    expect(addTag(values, "Pasta")).toBe(values);
  });

  describe("Mausklick auf einen Vorschlag (Regression: Erd -> Erdnuss -> Klick -> Tag Erdnuss)", () => {
    const click = () => ({ preventDefault: vi.fn() });

    it("übernimmt den kanonischen Wert und der Tag steht danach im Array", () => {
      const [suggestion] = suggestAllergens("Erd");
      expect(suggestion.label).toBe("Erdnuss");
      const event = click();
      expect(selectSuggestion(event, [], suggestion)).toEqual(["Erdnuss"]);
    });

    it("hängt an vorhandene Tags an und lässt sie unverändert", () => {
      const [suggestion] = suggestAllergens("Erd");
      expect(selectSuggestion(click(), ["Milch"], suggestion)).toEqual(["Milch", "Erdnuss"]);
    });

    it("bricht die Label-Aktivierung ab: Das Feld liegt im <label>, ein zweiter Klick auf den ersten Chip-Button würde den neuen Tag sofort wieder entfernen", () => {
      const [suggestion] = suggestAllergens("Erd");
      const event = click();
      selectSuggestion(event, [], suggestion);
      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it("liefert dasselbe Ergebnis wie Enter auf dem aktiven Vorschlag", () => {
      const suggestions = suggestAllergens("Erd");
      const viaEnter = addTag(["Milch"], tagToCommit("Erd", suggestions, 0));
      const viaClick = selectSuggestion(click(), ["Milch"], suggestions[0]);
      expect(viaClick).toEqual(viaEnter);
    });

    it("Duplikatlogik bleibt erhalten: ein bereits vorhandener Tag wird nicht doppelt gespeichert", () => {
      const values = ["Erdnuss"];
      expect(selectSuggestion(click(), values, { label: "Erdnuss" })).toBe(values);
    });

    it("gilt ebenso für Food-Vorschläge ('Nud' -> Pasta)", () => {
      const [suggestion] = suggestFoods(foods, "Nud");
      expect(selectSuggestion(click(), ["Reis"], suggestion)).toEqual(["Reis", "Pasta"]);
    });
  });

  it("die Pfeiltasten bewegen den aktiven Eintrag begrenzt, ohne im Kreis zu laufen", () => {
    expect(moveActive(0, 3, 1)).toBe(1);
    expect(moveActive(2, 3, 1)).toBe(2);
    expect(moveActive(0, 3, -1)).toBe(0);
    expect(moveActive(-1, 0, 1)).toBe(-1);
  });
});
