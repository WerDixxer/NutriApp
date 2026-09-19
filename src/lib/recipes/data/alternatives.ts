import type { AlternativeDef, AlternativeType } from "../types";

/**
 * Zentral gepflegte Lebensmittel-Alternativen (gerichtet: "im Rezept mit A
 * kann B verwendet werden"). Bewusst NICHT automatisch symmetrisch - was für
 * Skyr -> Magerquark gilt, muss für Magerquark -> Skyr separat gepflegt sein.
 *
 * `ctx` (= requiresContext) markiert Kanten, die nur je nach Rezept
 * funktionieren (Avocado -> Hummus, Hähnchen -> Tofu, Frischkäse ->
 * Hüttenkäse "wenn funktional passend"). Sie werden als Möglichkeit gemeldet,
 * aber nie automatisch eingesetzt (personalization.ts). Alle Kanten ohne
 * `ctx` sind funktionale Drop-in-Alternativen.
 *
 * Kanten außerhalb der im Auftrag genannten Listen sind mit "Ergänzung"
 * kommentiert.
 */
type Edge = [to: string, type: AlternativeType, ctx?: boolean, note?: string];

const TABLE: Record<string, Edge[]> = {
  // ---- Milchprodukte ----
  skyr: [
    ["magerquark", "similar"],
    ["griechischer-joghurt", "similar"],
    ["naturjoghurt", "similar"],
    ["laktosefreier-skyr", "lactose-free"],
    ["sojajoghurt", "dairy-free"],
  ],
  magerquark: [
    ["skyr", "similar"],
    ["griechischer-joghurt", "similar"],
    ["naturjoghurt", "similar"],
  ],
  "griechischer-joghurt": [
    ["skyr", "similar"],
    ["magerquark", "similar"],
    ["naturjoghurt", "similar"],
  ],
  // Ergänzung: Naturjoghurt taucht in Rezepten als Topping/Basis auf.
  naturjoghurt: [
    ["griechischer-joghurt", "similar"],
    ["skyr", "higher-protein", true, "Deutlich proteinreicher und fester, nur wenn das Rezept es verträgt."],
    ["sojajoghurt", "dairy-free"],
  ],
  milch: [
    ["laktosefreie-milch", "lactose-free"],
    ["sojadrink", "dairy-free"],
    ["haferdrink", "dairy-free"],
    ["mandeldrink", "dairy-free"],
  ],
  frischkaese: [
    ["frischkaese-light", "lower-calorie"],
    ["huettenkaese", "similar", true, "Nur wenn funktional passend (Konsistenz, Streichfähigkeit)."],
    ["veganer-frischkaese", "vegan"],
  ],
  // Ergänzung: Frischkäse light kommt in Rezepten direkt vor.
  "frischkaese-light": [
    ["huettenkaese", "similar", true, "Nur wenn funktional passend (Konsistenz, Streichfähigkeit)."],
    ["veganer-frischkaese", "vegan"],
  ],
  parmesan: [
    ["hartkaese", "similar"],
    ["hefeflocken", "vegan", true, "Würzt ähnlich, schmilzt aber nicht."],
  ],
  halloumi: [
    ["feta", "similar"],
    ["tofu", "vegan", true, "Nur angebraten/mariniert sinnvoll."],
  ],

  // ---- Proteinquellen ----
  haehnchenbrust: [
    ["putenbrust", "similar"],
    ["tofu", "vegan", true],
    ["seitan", "vegan", true, "Nur wenn passend."],
  ],
  putenbrust: [
    ["haehnchenbrust", "similar"],
    ["tofu", "vegan", true],
  ],
  rindfleisch: [
    ["haehnchenbrust", "similar"],
    ["putenbrust", "similar"],
    ["tofu", "vegan", true],
    ["vegane-hackalternative", "vegan", true],
  ],
  lachs: [
    ["forelle", "similar"],
    ["fischfilet", "similar", true, "Deutlich magerer und milder als Lachs."],
    ["tofu", "vegan", true, "Nur wenn das Rezept entsprechend angepasst werden kann."],
  ],
  thunfisch: [
    ["fischfilet", "similar", true],
    ["kichererbsen", "vegan", true, "Für Salate."],
    ["haehnchenbrust", "dietary", true, "Nur wenn funktional passend."],
  ],
  ei: [
    ["tofu", "vegan", true, "Als Rührtofu (Tofu Scramble), nicht überall einsetzbar."],
    ["eiersatz", "vegan", true, "Geeigneter pflanzlicher Eiersatz, je nach Verwendung."],
  ],

  // ---- Kohlenhydratquellen ----
  reis: [
    ["kartoffeln", "similar", true, "Andere Garmethode und Zeit."],
    ["suesskartoffel", "similar", true, "Andere Garmethode und Zeit."],
    ["couscous", "similar"],
    ["bulgur", "similar"],
    ["quinoa", "similar"],
  ],
  pasta: [
    ["vollkornpasta", "similar"],
    ["dinkelpasta", "similar"],
    ["glutenfreie-pasta", "gluten-free"],
    ["linsenpasta", "higher-protein"],
  ],
  haferflocken: [
    ["dinkelflocken", "similar"],
    ["glutenfreie-haferflocken", "gluten-free"],
  ],
  toast: [
    ["vollkorntoast", "similar"],
    ["vollkornbrot", "similar"],
    ["glutenfreies-brot", "gluten-free"],
  ],
  reiswaffeln: [["maiswaffeln", "similar"]],
  tortilla: [
    ["vollkorn-tortilla", "similar"],
    ["glutenfreie-tortilla", "gluten-free"],
  ],

  // ---- Hülsenfrüchte ----
  kidneybohnen: [
    ["schwarze-bohnen", "similar"],
    ["kichererbsen", "similar"],
  ],
  kichererbsen: [
    ["kidneybohnen", "similar"],
    ["weisse-bohnen", "similar"],
  ],

  // ---- Fette / Nüsse ----
  erdnussbutter: [
    ["mandelmus", "similar"],
    ["cashewmus", "similar"],
    ["tahini", "similar", true, "Deutlich anderer Geschmack."],
  ],
  avocado: [["hummus", "similar", true, "Nicht automatisch ersetzen: nur wenn die Rezeptlogik es zulässt."]],

  // ---- Süßungsmittel ----
  honig: [
    ["ahornsirup", "vegan"],
    ["agavendicksaft", "vegan"],
    ["suessstoff", "lower-calorie", true, "Nicht bei Rezepten, in denen der Zucker als Energiequelle dient."],
  ],
  marmelade: [
    ["marmelade-zuckerreduziert", "lower-calorie"],
    ["fruchtaufstrich", "similar"],
  ],
};

export const ALTERNATIVES: AlternativeDef[] = Object.entries(TABLE).flatMap(([from, edges]) =>
  edges.map(([to, type, ctx, note]) => ({
    from,
    to,
    type,
    requiresContext: ctx === true,
    ...(note ? { note } : {}),
  })),
);
