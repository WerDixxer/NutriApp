import type { DietClass, FoodDef, Per100, UnitGrams } from "../types";

/**
 * Zentrale, kuratierte Food-Tabelle. EINE Definition je Lebensmittel; Rezepte,
 * Alternativen, Präferenz-Auflösung und Nährwertberechnung verweisen alle per
 * `slug` hierher.
 *
 * Nährwerte: Referenz-/Richtwerte je 100 g (Flüssigkeiten je 100 ml) für den
 * Zustand, in dem die Zutat in den Rezepten gewogen wird (Reis, Pasta,
 * Couscous, Haferflocken = ungekocht/trocken; Bohnen, Kichererbsen, Mais,
 * Thunfisch = abgetropft aus der Dose). Sie sind aus gängigen Nährwerttabellen
 * typisch gerundet, NICHT gegen eine bestimmte Quelle oder ein Herstellerlabel
 * verifiziert. Die Tests prüfen nur Plausibilität (Atwater-Konsistenz), nicht
 * Richtigkeit.
 *
 * Spaltenreihenfolge: [kcal, Protein, Kohlenhydrate, Fett, Ballaststoffe,
 * Zucker, ges. Fett, Natrium in mg].
 */
type N = [number, number, number, number, number, number, number, number];

function per100(n: N): Per100 {
  return {
    kcal: n[0],
    proteinG: n[1],
    carbsG: n[2],
    fatG: n[3],
    fiberG: n[4],
    sugarG: n[5],
    saturatedFatG: n[6],
    sodiumMg: n[7],
  };
}

interface FoodOptions {
  allergens?: string[];
  aliases?: string[];
  unitGrams?: UnitGrams;
  negligible?: boolean;
  note?: string;
}

function food(
  slug: string,
  name: string,
  category: string,
  dietClass: DietClass,
  nutrition: N | null,
  options: FoodOptions = {},
): FoodDef {
  return {
    slug,
    name,
    category,
    dietClass,
    allergens: options.allergens ?? [],
    aliases: options.aliases ?? [],
    nutrition: nutrition ? per100(nutrition) : null,
    ...(options.negligible ? { negligible: true } : {}),
    ...(options.unitGrams ? { unitGrams: options.unitGrams } : {}),
    ...(options.note ? { note: options.note } : {}),
  };
}

export const FOODS: FoodDef[] = [
  // ---- Milchprodukte & Ei ----
  food("skyr", "Skyr", "dairy", "vegetarian", [63, 11, 4, 0.2, 0, 4, 0.1, 50], { allergens: ["milch"], aliases: ["skyr natur", "isländischer skyr"] }),
  food("magerquark", "Magerquark", "dairy", "vegetarian", [67, 12, 4, 0.3, 0, 4, 0.2, 40], { allergens: ["milch"], aliases: ["quark", "quark mager", "speisequark"] }),
  food("griechischer-joghurt", "Griechischer Joghurt", "dairy", "vegetarian", [73, 10, 4, 2, 0, 4, 1.3, 36], { allergens: ["milch"], aliases: ["griechischer naturjoghurt", "joghurt griechisch"], note: "ca. 2 % Fett" }),
  food("naturjoghurt", "Naturjoghurt", "dairy", "vegetarian", [47, 4, 4.5, 1.5, 0, 4.5, 1, 50], { allergens: ["milch"], aliases: ["joghurt", "joghurt natur", "natur joghurt"], note: "ca. 1,5 % Fett" }),
  food("laktosefreier-skyr", "Laktosefreier Skyr", "dairy", "vegetarian", [63, 11, 4, 0.2, 0, 4, 0.1, 50], { allergens: ["milch"], aliases: ["skyr laktosefrei"] }),
  food("sojajoghurt", "Sojajoghurt", "dairy-alternative", "vegan", [50, 4, 2.5, 2.3, 0.6, 2, 0.4, 20], { allergens: ["soja"], aliases: ["soja joghurt", "sojajoghurt natur"] }),
  food("milch", "Milch", "dairy", "vegetarian", [47, 3.4, 4.9, 1.5, 0, 4.9, 1, 45], { allergens: ["milch"], aliases: ["kuhmilch", "vollmilch", "milch 1,5%"], unitGrams: { ml: 1.03 }, note: "ca. 1,5 % Fett" }),
  food("laktosefreie-milch", "Laktosefreie Milch", "dairy", "vegetarian", [47, 3.4, 4.9, 1.5, 0, 4.9, 1, 45], { allergens: ["milch"], aliases: ["milch laktosefrei"], unitGrams: { ml: 1.03 } }),
  food("sojadrink", "Sojadrink", "dairy-alternative", "vegan", [39, 3.3, 2.1, 1.8, 0.5, 2, 0.3, 30], { allergens: ["soja"], aliases: ["sojamilch", "soja drink", "sojadrink natur"], unitGrams: { ml: 1.03 } }),
  food("haferdrink", "Haferdrink", "dairy-alternative", "vegan", [45, 1, 7, 1.5, 0.8, 4, 0.2, 40], { allergens: ["gluten"], aliases: ["hafermilch", "hafer drink", "haferdrink natur"], unitGrams: { ml: 1.03 } }),
  food("mandeldrink", "Mandeldrink", "dairy-alternative", "vegan", [24, 0.7, 3, 1.1, 0.4, 2.7, 0.1, 45], { allergens: ["nüsse"], aliases: ["mandelmilch", "mandel drink"], unitGrams: { ml: 1.03 } }),
  food("kochsahne-light", "Kochsahne light", "dairy", "vegetarian", [93, 3, 4.5, 7, 0, 4, 4.8, 45], { allergens: ["milch"], aliases: ["leichte kochsahne", "kochsahne", "cremefine", "kochcreme light"], unitGrams: { ml: 1 } }),
  food("sahne", "Sahne", "dairy", "vegetarian", [292, 2.4, 3.3, 30, 0, 3.3, 20, 30], { allergens: ["milch"], aliases: ["schlagsahne", "kochsahne 30%"], unitGrams: { ml: 1 } }),
  food("kaese", "Käse", "dairy", "vegetarian", [356, 25, 0.1, 28, 0, 0.1, 18, 700], { allergens: ["milch"], aliases: ["gouda", "schnittkäse", "reibekäse", "emmentaler"] }),
  food("parmesan", "Parmesan", "dairy", "vegetarian", [392, 36, 0, 28, 0, 0, 18, 1500], { allergens: ["milch"], aliases: ["parmigiano", "grana padano"], note: "Klassisch mit tierischem Lab hergestellt; hier wie im Auftrag als vegetarisch geführt." }),
  food("hartkaese", "Hartkäse", "dairy", "vegetarian", [400, 28, 0, 32, 0, 0, 20, 700], { allergens: ["milch"], aliases: ["bergkäse", "hartkäse", "pecorino"] }),
  food("hefeflocken", "Hefeflocken", "seasoning-alt", "vegan", [340, 48, 30, 4, 20, 0.5, 0.5, 20], { aliases: ["nährhefe", "hefeflocken"] }),
  food("halloumi", "Halloumi", "dairy", "vegetarian", [321, 21, 2, 25, 0, 2, 16, 1100], { allergens: ["milch"], aliases: ["grillkäse"] }),
  food("feta", "Feta", "dairy", "vegetarian", [264, 14, 4, 21, 0, 4, 14, 1100], { allergens: ["milch"], aliases: ["schafskäse", "hirtenkäse"] }),
  food("frischkaese", "Frischkäse", "dairy", "vegetarian", [253, 5.5, 3.5, 24, 0, 3.5, 16, 350], { allergens: ["milch"], aliases: ["frischkäse natur", "doppelrahmfrischkäse"] }),
  food("frischkaese-light", "Frischkäse light", "dairy", "vegetarian", [113, 9, 4, 7, 0, 4, 4.7, 400], { allergens: ["milch"], aliases: ["leichter frischkäse", "frischkäse fettreduziert"] }),
  food("veganer-frischkaese", "Veganer Frischkäse", "dairy-alternative", "vegan", [235, 3, 8, 21, 0.5, 1, 14, 500], { aliases: ["frischkäse vegan", "pflanzlicher frischkäse"] }),
  food("huettenkaese", "Hüttenkäse", "dairy", "vegetarian", [98, 12.5, 3.2, 4.3, 0, 3, 2.7, 300], { allergens: ["milch"], aliases: ["hüttenkaese", "cottage cheese"] }),
  food("ei", "Ei", "egg", "vegetarian", [143, 12.6, 0.7, 9.5, 0, 0.4, 3.1, 140], { allergens: ["ei"], aliases: ["eier", "hühnerei", "hühnereier"], unitGrams: { piece: 55 }, note: "Größe M, essbarer Anteil" }),
  food("eiersatz", "Eiersatz", "egg-alternative", "vegan", null, { aliases: ["pflanzlicher eiersatz", "ei ersatz"], note: "Produktabhängig, daher ohne Nährwerte." }),

  // ---- Fleisch, Fisch, pflanzliches Protein ----
  food("haehnchenbrust", "Hähnchenbrust", "poultry", "omnivore", [110, 23, 0, 1.5, 0, 0, 0.4, 60], { aliases: ["hähnchen", "hühnchen", "hähnchenfleisch", "huhn", "chicken", "hähnchenbrustfilet", "hühnerbrust", "poulet"] }),
  food("putenbrust", "Putenbrust", "poultry", "omnivore", [105, 24, 0, 1, 0, 0, 0.3, 50], { aliases: ["pute", "putenfleisch", "truthahn", "putenbrustfilet", "putenschnitzel"] }),
  food("putenhackfleisch", "Putenhackfleisch", "poultry", "omnivore", [138, 20, 0, 6, 0, 0, 1.7, 70], { aliases: ["putenhack", "hackfleisch pute"] }),
  food("rindfleisch", "Rindfleisch", "meat", "omnivore", [133, 21, 0, 5, 0, 0, 2, 60], { aliases: ["rind", "rindersteak", "rinderstreifen", "rindergeschnetzeltes", "rinderfilet"], note: "mageres Rindfleisch, roh" }),
  food("lachs", "Lachs", "fish", "pescatarian", [208, 20, 0, 13, 0, 0, 3, 60], { allergens: ["fisch"], aliases: ["lachsfilet", "salmon"] }),
  food("forelle", "Forelle", "fish", "pescatarian", [141, 20, 0, 6.2, 0, 0, 1.5, 50], { allergens: ["fisch"], aliases: ["forellenfilet", "lachsforelle"] }),
  food("fischfilet", "Fischfilet", "fish", "pescatarian", [81, 17.5, 0, 0.9, 0, 0, 0.2, 90], { allergens: ["fisch"], aliases: ["fisch", "seelachs", "weißfisch", "weissfisch", "kabeljau", "anderer fisch"], note: "Weißfisch, z.B. Seelachs" }),
  food("thunfisch", "Thunfisch", "fish", "pescatarian", [116, 25.5, 0, 0.8, 0, 0, 0.2, 250], { allergens: ["fisch"], aliases: ["thunfisch dose", "thunfisch im eigenen saft", "thunfischkonserve"], unitGrams: { can: 130 }, note: "im eigenen Saft, abgetropft; 1 Dose = ca. 130 g Abtropfgewicht" }),
  food("tofu", "Tofu", "plant-protein", "vegan", [125, 13, 1.5, 7, 1, 0.5, 1.1, 10], { allergens: ["soja"], aliases: ["naturtofu", "räuchertofu", "rührtofu", "tofu natur"] }),
  food("seitan", "Seitan", "plant-protein", "vegan", [130, 24, 4, 2, 1, 0.5, 0.3, 400], { allergens: ["gluten"], aliases: ["weizeneiweiß"] }),
  food("vegane-hackalternative", "Vegane Hackalternative", "plant-protein", "vegan", null, { allergens: ["soja"], aliases: ["veganes hack", "sojahack", "sojagranulat", "hackalternative"], note: "Produktabhängig, daher ohne Nährwerte." }),
  food("proteinpulver", "Proteinpulver", "supplement", "vegetarian", [380, 78, 6, 6, 0, 4, 3.5, 250], { allergens: ["milch"], aliases: ["whey", "eiweißpulver", "proteinpulver whey", "whey protein", "proteinshake pulver"], note: "Whey-Konzentrat, ungesüßt/neutral" }),

  // ---- Getreide, Brot, Pasta ----
  food("haferflocken", "Haferflocken", "grain", "vegan", [372, 13.5, 59, 7, 10, 1, 1.3, 5], { allergens: ["gluten"], aliases: ["hafer", "zarte haferflocken", "kernige haferflocken", "oats", "haferflocken zart"], note: "trocken" }),
  food("dinkelflocken", "Dinkelflocken", "grain", "vegan", [355, 12, 63, 2.5, 8, 1, 0.5, 5], { allergens: ["gluten"], aliases: ["dinkelflocken"], note: "trocken" }),
  food("glutenfreie-haferflocken", "Glutenfreie Haferflocken", "grain", "vegan", [372, 13.5, 59, 7, 10, 1, 1.3, 5], { aliases: ["haferflocken glutenfrei"], note: "trocken" }),
  food("vollkornbrot", "Vollkornbrot", "bread", "vegan", [210, 7, 38, 1.5, 7, 3, 0.3, 450], { allergens: ["gluten"], aliases: ["vollkorn brot", "roggenvollkornbrot", "körnerbrot"], unitGrams: { slice: 45 } }),
  food("vollkorntoast", "Vollkorntoast", "bread", "vegetarian", [250, 9, 43, 3.5, 6, 4, 0.7, 500], { allergens: ["gluten"], aliases: ["vollkorn toast", "vollkorntoastbrot"], unitGrams: { slice: 30 }, note: "Toastbrot enthält häufig Milchbestandteile, daher konservativ vegetarisch." }),
  food("toast", "Toast", "bread", "vegetarian", [265, 8, 50, 3, 3, 4, 0.7, 500], { allergens: ["gluten"], aliases: ["toastbrot", "weißbrot", "weissbrot", "weizentoast", "weißbrot toast"], unitGrams: { slice: 27 }, note: "Toastbrot enthält häufig Milchbestandteile, daher konservativ vegetarisch." }),
  food("glutenfreies-brot", "Glutenfreies Brot", "bread", "vegetarian", [240, 3.5, 45, 4.5, 4, 3, 0.6, 500], { aliases: ["brot glutenfrei", "glutenfreies toast"], unitGrams: { slice: 35 }, note: "Rezepturen enthalten häufig Ei, daher konservativ vegetarisch." }),
  food("reis", "Reis", "grain", "vegan", [350, 7, 78, 0.6, 1, 0.1, 0.2, 5], { aliases: ["langkornreis", "basmatireis", "jasminreis", "vollkornreis", "reis ungekocht"], note: "ungekocht" }),
  food("kartoffeln", "Kartoffeln", "starch", "vegan", [72, 2, 15, 0.1, 2, 0.8, 0, 6], { aliases: ["kartoffel", "erdäpfel", "salzkartoffeln"], note: "roh" }),
  food("suesskartoffel", "Süßkartoffel", "starch", "vegan", [86, 1.6, 20, 0.1, 3, 4.2, 0, 55], { aliases: ["süßkartoffeln", "suesskartoffeln", "batate"], note: "roh" }),
  food("couscous", "Couscous", "grain", "vegan", [360, 12.5, 73, 1.6, 4, 2, 0.3, 10], { allergens: ["gluten"], aliases: ["cous cous"], note: "trocken" }),
  food("bulgur", "Bulgur", "grain", "vegan", [345, 12, 64, 1.5, 12, 1, 0.3, 20], { allergens: ["gluten"], aliases: ["bulgur weizen"], note: "trocken" }),
  food("quinoa", "Quinoa", "grain", "vegan", [368, 14, 64, 6, 7, 3, 0.7, 5], { aliases: ["quinoa weiß"], note: "trocken" }),
  food("pasta", "Pasta", "pasta", "vegan", [358, 12.5, 71, 1.5, 3, 3, 0.3, 5], { allergens: ["gluten"], aliases: ["nudeln", "spaghetti", "penne", "fusilli", "makkaroni", "hartweizennudeln"], note: "Hartweizen, ungekocht" }),
  food("vollkornpasta", "Vollkornpasta", "pasta", "vegan", [350, 13, 62, 2.5, 9, 3, 0.4, 10], { allergens: ["gluten"], aliases: ["vollkornnudeln", "vollkorn pasta"], note: "ungekocht" }),
  food("dinkelpasta", "Dinkelpasta", "pasta", "vegan", [352, 13, 65, 2.5, 6, 3, 0.4, 10], { allergens: ["gluten"], aliases: ["dinkelnudeln"], note: "ungekocht" }),
  food("glutenfreie-pasta", "Glutenfreie Pasta", "pasta", "vegan", [357, 7, 77, 1.5, 3, 1, 0.3, 10], { aliases: ["glutenfreie nudeln", "pasta glutenfrei"], note: "ungekocht" }),
  food("linsenpasta", "Linsenpasta", "pasta", "vegan", [340, 25, 50, 2.5, 10, 2, 0.4, 10], { aliases: ["linsennudeln", "rote linsen pasta"], note: "ungekocht" }),
  food("gnocchi", "Gnocchi", "pasta", "vegan", [153, 3.8, 32, 0.6, 2, 1, 0.1, 400], { allergens: ["gluten"], aliases: ["kartoffelgnocchi"], note: "fertig, aus der Packung" }),
  food("tortilla", "Tortilla", "bread", "vegan", [310, 8.5, 52, 7, 3, 2, 2.5, 650], { allergens: ["gluten"], aliases: ["tortillas", "wrap", "wraps", "weizentortilla"], unitGrams: { piece: 60 } }),
  food("vollkorn-tortilla", "Vollkorn-Tortilla", "bread", "vegan", [290, 10, 45, 6, 7, 2, 1.5, 600], { allergens: ["gluten"], aliases: ["vollkorntortilla", "vollkornwrap"], unitGrams: { piece: 60 } }),
  food("glutenfreie-tortilla", "Glutenfreie Tortilla", "bread", "vegan", [300, 3, 50, 9, 3, 2, 3, 600], { aliases: ["tortilla glutenfrei", "glutenfreier wrap"], unitGrams: { piece: 60 } }),
  food("reiswaffeln", "Reiswaffeln", "snack", "vegan", [380, 8, 81, 3, 3, 0.5, 0.6, 50], { aliases: ["reiswaffel", "reiscracker", "reiskuchen"], unitGrams: { piece: 8.5 } }),
  food("maiswaffeln", "Maiswaffeln", "snack", "vegan", [385, 8, 80, 3, 4, 0.5, 0.6, 50], { aliases: ["maiswaffel", "maiscracker"], unitGrams: { piece: 8.5 } }),
  food("cornflakes", "Cornflakes", "cereal", "vegan", [375, 7, 82, 1, 3, 8, 0.3, 650], { allergens: ["gluten"], aliases: ["cornflake", "frühstücksflocken"] }),

  // ---- Hülsenfrüchte ----
  food("kidneybohnen", "Kidneybohnen", "legume", "vegan", [95, 6.5, 16, 0.5, 6, 1, 0.1, 180], { aliases: ["kidneybohne", "rote bohnen", "kidney bohnen"], note: "aus der Dose, abgetropft" }),
  food("schwarze-bohnen", "Schwarze Bohnen", "legume", "vegan", [95, 6.5, 16, 0.5, 6.5, 0.5, 0.1, 200], { aliases: ["black beans", "schwarze bohne"], note: "aus der Dose, abgetropft" }),
  food("weisse-bohnen", "Weiße Bohnen", "legume", "vegan", [90, 6, 15, 0.5, 5.5, 0.5, 0.1, 200], { aliases: ["weiße bohnen", "weisse bohnen", "cannellini"], note: "aus der Dose, abgetropft" }),
  food("kichererbsen", "Kichererbsen", "legume", "vegan", [128, 7, 19, 2.5, 6, 1, 0.3, 250], { aliases: ["kichererbse", "chickpeas"], note: "aus der Dose, abgetropft" }),

  // ---- Obst & Gemüse ----
  food("banane", "Banane", "fruit", "vegan", [95, 1.1, 21, 0.2, 1.8, 14, 0.1, 1], { aliases: ["bananen"], unitGrams: { piece: 120 }, note: "essbarer Anteil" }),
  food("apfel", "Apfel", "fruit", "vegan", [52, 0.3, 13.8, 0.2, 2.4, 10.4, 0, 1], { aliases: ["äpfel"], unitGrams: { piece: 180 } }),
  food("beeren", "Beeren", "fruit", "vegan", [45, 0.9, 8.5, 0.4, 4, 5.5, 0, 2], { aliases: ["beerenmix", "heidelbeeren", "blaubeeren", "erdbeeren", "himbeeren", "waldbeeren", "tk-beeren", "beere"], note: "gemischt, frisch oder TK" }),
  food("avocado", "Avocado", "fruit", "vegan", [160, 2, 8.5, 14.7, 6.7, 0.7, 2.1, 7], { aliases: ["avocados"], unitGrams: { piece: 150 }, note: "essbarer Anteil; 1 Avocado = ca. 150 g Fruchtfleisch" }),
  food("datteln", "Datteln", "fruit", "vegan", [277, 1.8, 75, 0.2, 7, 66, 0, 1], { aliases: ["dattel", "medjool datteln"], unitGrams: { piece: 24 }, note: "Medjool" }),
  food("apfelmus", "Apfelmus", "fruit", "vegan", [46, 0.3, 10.5, 0.1, 1.2, 9.5, 0, 3], { aliases: ["apfelmark"], note: "ungesüßt" }),
  food("paprika", "Paprika", "vegetable", "vegan", [31, 1, 6, 0.3, 2, 4.2, 0.1, 4], { aliases: ["paprikaschote", "paprikaschoten", "rote paprika", "gelbe paprika", "spitzpaprika"] }),
  food("tomaten", "Tomaten", "vegetable", "vegan", [18, 0.9, 3.9, 0.2, 1.2, 2.6, 0, 5], { aliases: ["tomate", "cherrytomaten", "kirschtomaten"] }),
  food("gehackte-tomaten", "Gehackte Tomaten", "vegetable", "vegan", [21, 1.2, 3.5, 0.2, 1.2, 3.2, 0, 150], { aliases: ["tomaten gehackt", "dosentomaten", "stückige tomaten"], note: "aus der Dose" }),
  food("tomatensauce", "Tomatensauce", "sauce", "vegan", [40, 1.6, 7, 0.8, 1.5, 5, 0.1, 300], { aliases: ["tomatensoße", "passata", "pastasauce"] }),
  food("zwiebel", "Zwiebel", "vegetable", "vegan", [40, 1.1, 9, 0.1, 1.7, 4.2, 0, 4], { aliases: ["zwiebeln", "gemüsezwiebel", "rote zwiebel"] }),
  food("brokkoli", "Brokkoli", "vegetable", "vegan", [34, 2.8, 6.6, 0.4, 2.6, 1.7, 0.1, 33], { aliases: ["broccoli"] }),
  food("karotte", "Karotte", "vegetable", "vegan", [41, 0.9, 9.6, 0.2, 2.8, 4.7, 0, 69], { aliases: ["karotten", "möhre", "möhren", "mohrrübe"] }),
  food("spinat", "Spinat", "vegetable", "vegan", [23, 2.9, 3.6, 0.4, 2.2, 0.4, 0.1, 79], { aliases: ["blattspinat", "babyspinat"] }),
  food("mais", "Mais", "vegetable", "vegan", [85, 2.9, 15, 1.5, 2.5, 5, 0.2, 200], { aliases: ["maiskörner", "gemüsemais"], note: "aus der Dose, abgetropft" }),
  food("gurke", "Gurke", "vegetable", "vegan", [12, 0.6, 2.2, 0.1, 0.7, 1.7, 0, 2], { aliases: ["salatgurke", "gurken", "salatgurken"] }),
  food("salat", "Salat", "vegetable", "vegan", [15, 1.3, 2, 0.2, 1.5, 1, 0, 25], { aliases: ["blattsalat", "eisbergsalat", "salatmix", "gemischter salat", "kopfsalat"] }),
  food("roemersalat", "Römersalat", "vegetable", "vegan", [17, 1.2, 3.3, 0.3, 2.1, 1.2, 0, 8], { aliases: ["romana", "romanasalat", "römersalat herzen"] }),
  food("zucchini", "Zucchini", "vegetable", "vegan", [17, 1.2, 3.1, 0.3, 1, 2.5, 0.1, 8], { aliases: ["zucchinis"] }),
  food("champignons", "Champignons", "vegetable", "vegan", [22, 3.1, 3.3, 0.3, 1, 2, 0, 5], { aliases: ["pilze", "pilz", "champignon", "egerlinge"] }),
  food("gemuese", "Gemüse", "vegetable", "vegan", [35, 2, 6, 0.3, 3, 3.5, 0, 40], { aliases: ["mischgemüse", "gemüsemix", "pfannengemüse", "tk-gemüse", "gemüse gemischt"], note: "gemischtes Pfannengemüse" }),
  food("knoblauch", "Knoblauch", "seasoning", "vegan", [149, 6.4, 33, 0.5, 2.1, 1, 0.1, 17], { aliases: ["knoblauchzehe", "knoblauchzehen"], negligible: true }),

  // ---- Fette, Öle, Aufstriche, Nüsse ----
  food("oel", "Öl", "fat", "vegan", [884, 0, 0, 100, 0, 0, 10, 0], { aliases: ["olivenöl", "rapsöl", "pflanzenöl", "sonnenblumenöl", "bratöl"], unitGrams: { ml: 0.92, tl: 4.6, el: 13.8 }, note: "Raps-/Olivenöl" }),
  food("kokosmilch-light", "Kokosmilch light", "dairy-alternative", "vegan", [75, 0.7, 2.5, 7, 0.2, 1.5, 6, 15], { aliases: ["kokosmilch", "kokosmilch leicht", "kokosdrink kochen"], unitGrams: { ml: 1 } }),
  food("erdnussbutter", "Erdnussbutter", "nut-butter", "vegan", [600, 25, 12, 50, 6, 6, 10, 10], { allergens: ["erdnuss"], aliases: ["erdnussmus", "peanutbutter", "peanut butter"] }),
  food("mandelmus", "Mandelmus", "nut-butter", "vegan", [615, 21, 17, 55, 10, 4, 4, 10], { allergens: ["nüsse"], aliases: ["mandelbutter", "mandelcreme"] }),
  food("cashewmus", "Cashewmus", "nut-butter", "vegan", [590, 18, 27, 49, 3, 6, 9, 15], { allergens: ["nüsse"], aliases: ["cashewbutter", "cashewcreme"] }),
  food("tahini", "Tahini", "nut-butter", "vegan", [595, 17, 21, 54, 9, 0.5, 7.5, 40], { allergens: ["sesam"], aliases: ["sesammus", "tahin"] }),
  food("hummus", "Hummus", "spread", "vegan", [230, 6, 14, 17, 5, 0.5, 2.5, 400], { allergens: ["sesam"], aliases: ["humus"] }),
  food("pesto", "Pesto", "sauce", "vegetarian", [470, 5, 6, 47, 2, 2, 7, 600], { allergens: ["milch", "nüsse"], aliases: ["basilikumpesto", "pesto verde", "grünes pesto"], note: "Basilikum-Pesto" }),

  // ---- Süßungsmittel, Aufstriche, Süßes ----
  food("honig", "Honig", "sweetener", "vegetarian", [304, 0.3, 82, 0, 0, 80, 0, 4], { aliases: ["bienenhonig", "blütenhonig"] }),
  food("ahornsirup", "Ahornsirup", "sweetener", "vegan", [260, 0, 67, 0, 0, 60, 0, 10], { aliases: ["ahorn sirup", "maple syrup"] }),
  food("agavendicksaft", "Agavendicksaft", "sweetener", "vegan", [310, 0.1, 76, 0.1, 0.2, 68, 0, 4], { aliases: ["agavensirup", "agavendicksaft"] }),
  food("suessstoff", "Süßstoff", "sweetener", "vegan", [0, 0, 0, 0, 0, 0, 0, 0], { aliases: ["kalorienfreier süßstoff", "süße", "süßungsmittel", "stevia", "erythrit"] }),
  food("marmelade", "Marmelade", "spread", "vegan", [250, 0.4, 60, 0.1, 0.5, 58, 0, 10], { aliases: ["konfitüre", "konfitüre extra", "erdbeermarmelade", "jam"] }),
  food("marmelade-zuckerreduziert", "Zuckerreduzierte Marmelade", "spread", "vegan", [140, 0.3, 33, 0.1, 1, 30, 0, 8], { aliases: ["marmelade zuckerreduziert", "diätmarmelade", "marmelade light"] }),
  food("fruchtaufstrich", "Fruchtaufstrich", "spread", "vegan", [180, 0.5, 42, 0.1, 1, 40, 0, 10], { aliases: ["fruchtaufstrich 100% frucht", "fruchtbrotaufstrich"] }),
  food("kakaopulver", "Kakaopulver", "sweetener", "vegan", [320, 22, 47, 11, 30, 1, 6, 20], { aliases: ["kakao", "backkakao", "kakao pulver"], note: "stark entölt" }),
  food("dunkle-schokolade", "Dunkle Schokolade", "sweetener", "vegetarian", [590, 8, 45, 43, 11, 25, 25, 10], { allergens: ["milch"], aliases: ["zartbitterschokolade", "schokolade dunkel", "bitterschokolade"], note: "ca. 70 % Kakao; enthält häufig Milchspuren, daher konservativ vegetarisch." }),

  // ---- Flüssigkeiten, Saucen, Gewürze ----
  food("wasser", "Wasser", "beverage", "vegan", [0, 0, 0, 0, 0, 0, 0, 0], { aliases: ["leitungswasser", "mineralwasser"], unitGrams: { ml: 1 } }),
  food("orangensaft", "Orangensaft", "beverage", "vegan", [43, 0.7, 10, 0.2, 0.2, 8.4, 0, 1], { aliases: ["orangen saft", "o-saft"], unitGrams: { ml: 1.04 } }),
  food("zitronensaft", "Zitronensaft", "seasoning", "vegan", [22, 0.4, 6.9, 0.2, 0.3, 2.5, 0, 1], { aliases: ["zitrone", "saft einer zitrone"], negligible: true, unitGrams: { ml: 1.03 } }),
  food("limettensaft", "Limettensaft", "seasoning", "vegan", [25, 0.4, 8.4, 0.1, 0.4, 1.7, 0, 2], { aliases: ["limette", "saft einer limette"], negligible: true, unitGrams: { ml: 1.03 } }),
  food("teriyaki-sauce", "Teriyaki-Sauce", "sauce", "vegan", [89, 5.9, 15.6, 0, 0.1, 14, 0, 3800], { allergens: ["soja", "gluten"], aliases: ["teriyakisauce", "teriyaki sauce", "teriyaki"], unitGrams: { ml: 1.15 } }),
  food("sojasauce", "Sojasauce", "seasoning", "vegan", [53, 8, 4.9, 0.1, 0.8, 0.4, 0, 5500], { allergens: ["soja", "gluten"], aliases: ["sojasoße", "soja sauce", "shoyu"], negligible: true, unitGrams: { ml: 1.15 } }),
  food("dressing-leicht", "Leichtes Dressing", "sauce", "vegan", [90, 0.5, 8, 6, 0.2, 5, 0.8, 900], { aliases: ["light dressing", "leichtes salatdressing", "joghurtdressing light"], unitGrams: { ml: 1 } }),
  food("caesar-dressing-leicht", "Leichtes Caesar-Dressing", "sauce", "omnivore", [110, 3, 8, 7.5, 0.2, 4, 1.5, 900], { allergens: ["milch", "ei", "fisch"], aliases: ["caesar dressing light", "caesar-dressing", "caesar dressing"], note: "Klassisches Caesar-Dressing enthält Sardellen, daher omnivore.", unitGrams: { ml: 1 } }),
  food("salz", "Salz", "seasoning", "vegan", null, { aliases: ["speisesalz", "meersalz"], negligible: true }),
  food("pfeffer", "Pfeffer", "seasoning", "vegan", null, { aliases: ["schwarzer pfeffer"], negligible: true }),
  food("gewuerze", "Gewürze", "seasoning", "vegan", null, { aliases: ["gewürz", "gewürzmischung", "kräuter"], negligible: true }),
  food("curry", "Curry", "seasoning", "vegan", null, { aliases: ["currypulver", "curry pulver", "currypaste"], negligible: true }),
  food("chili", "Chili", "seasoning", "vegan", null, { aliases: ["chilipulver", "chiliflocken", "chilischote"], negligible: true }),
  food("zimt", "Zimt", "seasoning", "vegan", null, { aliases: ["zimtpulver", "zimt gemahlen"], negligible: true }),
  food("backpulver", "Backpulver", "seasoning", "vegan", null, { aliases: ["backpulver"], negligible: true }),
];

export const FOODS_BY_SLUG: Map<string, FoodDef> = new Map(FOODS.map((f) => [f.slug, f]));
