import type { EvidenceClaimInput, EvidenceSourceInput } from "../../validation/evidence";

/**
 * Kuratierte Evidence-Library-Daten für Kerksick et al. (2017), "International
 * society of sports nutrition position stand: nutrient timing" (J Int Soc
 * Sports Nutr. 2017;14:33, PMC5596471).
 *
 * Diese 15 Claims sind das Ergebnis eines mehrstufigen, manuellen Audit-
 * Prozesses (Volltext gelesen, jeder Claim einzeln gegen den Volltext
 * verifiziert, `KERK17_MEAL_FREQUENCY_EXERCISE_PRELIMINARY` bewusst
 * verworfen, `KERK17_CHO_DAILY_HIGHVOLUME` separat gegen drei unterschiedliche
 * Textstellen im Paper abgeglichen). Inhalte hier NICHT ohne erneuten
 * Volltext-Abgleich verändern - siehe justification/limitations je Claim für
 * die exakte Quellenstelle.
 *
 * `evidenceStrength` ist unsere eigene konservative Einschätzung, nie das
 * Grading des Papers selbst (das Paper verwendet kein formales Evidence-
 * Grading-System). `recommendationConfidence` wird hier bewusst NICHT
 * geführt - das ist Aufgabe einer späteren, hier noch nicht gebauten
 * Evidence Engine.
 */

export const kerksick2017Source: EvidenceSourceInput = {
  citation:
    "Kerksick CM, Arent S, Schoenfeld BJ, Stout JR, Campbell B, Wilborn CD, Taylor L, Kalman D, Smith-Ryan AE, Kreider RB, Willoughby D, Arciero PJ, VanDusseldorp TA, Ormsbee MJ, Wildman R, Greenwood M, Ziegenfuss TN, Aragon AA, Antonio J. International society of sports nutrition position stand: nutrient timing. J Int Soc Sports Nutr. 2017;14:33.",
  doi: "10.1186/s12970-017-0189-4",
  pmid: "28919842",
  pmcid: "PMC5596471",
  accessedText: "FULL_TEXT",
};

export const kerksick2017Claims: EvidenceClaimInput[] = [
  {
    claimId: "KERK17_CONTEXT_DEPENDENCY",
    claimType: "CONTEXTUAL_LIMITATION",
    topic: "nutrient_timing_context_dependency",
    statement:
      "Nutrient timing recommendations depend on factors such as age, sex, fitness level, previous fueling status, dietary status, training volume, training intensity, program design and time until the next training bout. (Conclusions)",
    population: "Alle im Paper diskutierten Populationen",
    trainingContext: "übergreifend, alle Trainingsarten",
    trainingType: null,
    intensityOrDuration: null,
    nutritionContext: "übergreifend",
    timingContext: "übergreifend",
    direction: "CONDITIONAL",
    evidenceStrength: "HIGH",
    limitations: [],
    justification:
      "Wörtliches Zitat aus 'Conclusions'; strukturelle Meta-Aussage der Autoren, durch jeden Fachabschnitt des Papers demonstriert (z.B. Alterseffekt bei Andersen vs. Esmarck, Geschlechtseffekt bei CHO-Bedarf, Dosis-Effekt bei Hoffman vs. Andersen). HIGH bezieht sich auf die Konsistenz dieser Meta-Aussage, nicht auf einen physiologischen Effekt.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_PRE_ENDURANCE",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "pre_exercise_carbohydrate",
    statement:
      "For endurance exercise performed at ≥70% VO2max and lasting >90 minutes, consuming 1–4 g/kg carbohydrate in the hours beforehand is a commonly recommended strategy associated with increased pre-exercise glycogen stores and carbohydrate oxidation; performance effects across studies are mixed, not uniformly positive.",
    population: "Ausdauersportler; zugrunde liegende Studien überwiegend männlich",
    trainingContext: "Ausdauerbelastung vor Training/Wettkampf",
    trainingType: "endurance",
    intensityOrDuration: "≥70% VO2max, >90 min",
    nutritionContext: "1–4 g/kg CHO, mehrere Stunden vorher",
    timingContext: "pre-exercise",
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: [
      "Nicht alle zugrunde liegenden Studien zeigten einen Leistungseffekt",
      "Individuelle GI-Verträglichkeit/Gewöhnung wird in diesem Abschnitt des Papers nicht diskutiert — bewusst nicht ergänzt",
      "Datenbasis überwiegend männliche Athleten",
    ],
    justification:
      "Direktes Zitat, Abschnitt 'Carbohydrate > Endurance training', gestützt durch Coyle et al. Intensitäts-/Dauerbedingung ist im Statement selbst verankert, nicht nur in limitations.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_PRE_TIMING_PROXIMITY",
    claimType: "EVIDENCE_FINDING",
    topic: "pre_exercise_carbohydrate_timing",
    statement:
      "In several individual studies in trained cyclists (Moseley et al.; Galloway et al.; reviewed by Hawley & Burke), carbohydrate ingestion shortly (15–120 min) before exercise, when followed by a warm-up, did not consistently impair time-trial or capacity performance, and in some protocols was associated with improved outcomes; findings on the role of carbohydrate glycemic index remain unresolved (Febbraio et al.).",
    population: "Trainierte Radfahrer",
    trainingContext: "Radsport-Zeitfahr-/Kapazitätsprotokolle im Labor",
    trainingType: "endurance",
    intensityOrDuration: "~70–90% VO2max, 60–150 min Protokolle",
    nutritionContext: "CHO-Getränk, unterschiedliche Konzentrationen",
    timingContext: "15–120 min vor Belastung, mit Warm-up",
    direction: "NO_EFFECT",
    evidenceStrength: "LIMITED",
    limitations: [
      "Kleine Einzelstudien, unterschiedliche Protokolle (Zeitfahren vs. Kapazitätstest)",
      "Nicht auf Team-Sport- oder untrainierte Populationen übertragbar",
      "Glykämischer-Index-Interaktion bleibt laut Paper ungeklärt (Febbraio)",
    ],
    justification:
      "Synthese aus Abschnitt 'Carbohydrate > Endurance training', in dem die Rebound-Hypoglykämie-Hypothese diskutiert und relativiert wird.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_DURING_DURATION_DEPENDENT",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "carbohydrate_during_exercise",
    statement:
      "For exercise extending beyond 70 minutes, consuming a 6–8% carbohydrate-electrolyte solution (6–8 g carbohydrate per 100 mL fluid) is described as an effective strategy to replace fluid, sustain blood glucose, and support performance. In one cited cycling study (Newell et al.), carbohydrate intake rates of 39 g/h or 64 g/h — but not 20 g/h — significantly improved time-trial performance versus a no-carbohydrate control during a 2-hour bout at 95% lactate threshold. The source explicitly states that the need for carbohydrate during shorter-duration exercise is 'less established.'",
    population: "Ausdauersportler/Radfahrer (Newell et al.: 20 gut trainierte, erfahrene Radfahrer)",
    trainingContext: "kontinuierliche aerobe Ausdauerbelastung",
    trainingType: "endurance",
    intensityOrDuration: ">70 min Belastung; Newell-Studie: 2h bei 95% Laktatschwelle",
    nutritionContext: "6–8% CHO-Elektrolyt-Lösung; Newell-Studie: 39 oder 64 g/h wirksam, 20 g/h nicht",
    timingContext: "während der Belastung, regelmäßige Intervalle",
    direction: "CONDITIONAL",
    evidenceStrength: "MODERATE",
    limitations: [
      "Die konkrete Dosis-Wirkungs-Schwelle (39/64 g/h wirksam, 20 g/h nicht) stammt aus einer einzelnen Studie (Newell et al.) und ist keine allgemeine, über mehrere Studien bestätigte Grenze",
      "Für Belastungen <70 min laut Paper 'less established' — keine pauschale During-Exercise-CHO-Regel",
    ],
    justification:
      "Kombiniert die 'Practical applications'-Bullet (6–8%-Lösung, >70min-Schwelle, 'less established' für kürzere Belastung) mit der konkret zitierten Newell-Studie (20/39/64 g/h) im Abschnitt 'Carbohydrate > Endurance training'. Bewusst EIN Claim mit einem einzelnen evidenceStrength-Wert (MODERATE): die allgemeine >70min-Empfehlung ist der primäre Claim, die Newell-Einzelstudien-Dosisangabe bleibt in Statement/limitations/justification als Beispiel, nicht als eigener Claim mit eigenem Strength-Wert.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_DURING_RESISTANCE",
    claimType: "EVIDENCE_FINDING",
    topic: "carbohydrate_during_resistance_exercise",
    statement:
      "In one cited study, ingesting 1.0 g/kg carbohydrate pre-workout and 0.5 g/kg every 10 min throughout a 40-minute resistance exercise bout reduced muscle glycogen loss by 49% compared to a control condition. A clear performance benefit from carbohydrate ingestion during resistance exercise is not consistently demonstrated across the small number of available studies.",
    population: "Krafttrainierte Erwachsene",
    trainingContext: "Widerstandstraining, 40-min-Bout",
    trainingType: "resistance",
    intensityOrDuration: "40-min Bout",
    nutritionContext: "1,0 g/kg vor, 0,5 g/kg alle 10 min während",
    timingContext: "pre- und during-resistance-exercise",
    direction: "CONDITIONAL",
    evidenceStrength: "LIMITED",
    limitations: [
      "Nur eine Handvoll Studien insgesamt verfügbar, laut Paper selbst 'limited'",
      "Widersprüchliche Ergebnisse zwischen den wenigen verfügbaren Studien (Dalton, Kulik kein Effekt; Haff nur in zweiter von zwei Einheiten am selben Tag)",
    ],
    justification:
      "Direkt aus 'Carbohydrate > Resistance training'-Abschnitt, exakte Dosis-/Prozentzahl verifiziert.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_DAILY_HIGHVOLUME",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "daily_carbohydrate_intake",
    statement:
      "For athletes completing high volumes of exercise (≥8 h/week) who need to continually and rapidly replenish endogenous glycogen stores, the source describes a daily carbohydrate intake of 8–12 g/kg/day as the single most effective strategy to maximize endogenous glycogen stores. A separate, more intensity-specific statement elsewhere in the source (in a general discussion of daily carbohydrate needs, not tied to the ≥8 h/week threshold above) reserves a narrower range (8–10 g/kg/day) for athletes training at ≥70% VO2max for more than 12 h/week — the two statements use different weekly-volume thresholds and different upper carbohydrate limits and should not be merged into a single number.",
    population:
      "Athleten mit hohem Trainingsvolumen; Datenbasis überwiegend männliche Athleten (explizit im Paper vermerkt)",
    trainingContext: "hochvolumiges Training",
    trainingType: null,
    intensityOrDuration:
      "≥8 h/Woche (Practical Applications) bzw. separat: ≥70% VO2max + >12h/Woche (Fließtext, andere CHO-Spanne 8–10g/kg/day)",
    nutritionContext:
      "8–12 g/kg/day (Practical Applications-Bedingung) bzw. 8–10 g/kg/day (Fließtext-Bedingung) — NICHT identisch",
    timingContext: "täglich, nicht akut",
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: [
      "'single most effective strategy' ist die Formulierung der Autoren, nicht unsere eigene Schlussfolgerung",
      "Datenbasis laut Paper überwiegend männliche Ausdauerathleten; Übertragbarkeit auf Frauen unklar",
      "Zwei unterschiedliche Textstellen im Paper verwenden unterschiedliche Wochenstunden-Schwellen (≥8h vs. >12h) UND unterschiedliche CHO-Obergrenzen (8–12 vs. 8–10 g/kg/day) — dürfen nicht zu einer einzigen Zahl verschmolzen werden",
      "Nicht für Sportler mit geringem/moderatem Trainingsvolumen anzuwenden",
    ],
    justification:
      "Position Statement-Bullet ('8-12 g/kg/day... depleted most by high volume exercise', kein Wochenstundenwert) + Practical-Applications-Bullet ('≥8h... 8-12 g/kg/day', wörtlich verifiziert) + separate Fließtext-Stelle im Abschnitt 'Carbohydrate' ('8-10 g/kg/day... ≥70% VO2max... upwards of 12h per week [25-27]') — alle drei Stellen einzeln im Volltext lokalisiert und in einem dedizierten Verifikations-Durchgang gegeneinander abgeglichen.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHO_POST_RAPID_REFEED",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "post_exercise_glycogen_replenishment",
    statement:
      "If rapid restoration of glycogen is required (<4 h of recovery time), aggressive carbohydrate intake (~1.0–1.2 g/kg/h, e.g. 0.6–1.0 g/kg within 30 min then every 2h for 4–6h, or 1.2 g/kg every 30 min over 3.5h) accelerates glycogen resynthesis. Outside situations where rapid recovery is truly needed and daily carbohydrate intake matches energy demands, the source states that the importance of timed carbohydrate ingestion is 'notably decreased' — though in no situation has timed carbohydrate ingestion been shown to negatively impact performance or recovery.",
    population: "Ausdauertrainierte Erwachsene",
    trainingContext: "glykogendepletierende Belastung, kurze Erholungszeit vor nächster Belastung",
    trainingType: "endurance",
    intensityOrDuration: "68–88% VO2max Protokolle je nach zitierter Studie",
    nutritionContext:
      "1,0–1,2 g/kg/h; alternative Protokolle: 0,6–1,0 g/kg initial + alle 2h; oder 1,2 g/kg alle 30min über 3,5h",
    timingContext: "unmittelbar post-exercise bis 4–6h danach",
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: [
      "Explizit konditional: nur relevant bei (a) <4h Erholungszeit ODER (b) sonst unzureichender CHO-Zufuhr",
      "Wörtlich im Paper: 'in no situation has timed carbohydrate ingestion been shown to negatively impact performance or recovery' — Kontrastsatz ist Teil des Statements, nicht nur der Limitations",
    ],
    justification:
      "Position-Statement-Bullet + Ivy et al.-Studie + wörtlich verifizierter Kontrastsatz ('Outside of situations where rapid recovery is truly needed...') im Abschnitt 'Carbohydrate > Endurance training'.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_CHOPROTEIN_GLYCOGEN_CONDITIONAL",
    claimType: "EVIDENCE_FINDING",
    topic: "carbohydrate_protein_combination_recovery",
    statement:
      "Protein addition (0.2–0.4 g/kg/h per Position Statement; 0.2–0.5 g/kg/h per Practical Applications) to carbohydrate augments glycogen recovery specifically when carbohydrate ingestion is <1.2 g/kg/h (Ivy, Zawadzki, Berardi: positiver Effekt bei suboptimaler CHO-Menge). When carbohydrate ingestion is ≥1.2 g/kg/h, no added benefit from protein was shown (Jentjens et al.: kein Effekt bei 1,2 g/kg/h CHO + 0,4 g/kg/h Protein; Howarth et al.: auch höhere CHO-Dosis von 1,6 g/kg/h zeigte keinen Zusatzeffekt).",
    population: "Trainierte Radfahrer/Ausdauersportler",
    trainingContext: "Recovery nach erschöpfender Ausdauerbelastung",
    trainingType: "endurance",
    intensityOrDuration: "2,5–3h Recovery-Fenster je nach Studie",
    nutritionContext: "CHO+Protein-Kombination, Schwelle bei 1,2 g/kg/h CHO",
    timingContext: "post-exercise, 2–3h Recovery-Fenster",
    direction: "CONDITIONAL",
    evidenceStrength: "MODERATE",
    limitations: [
      "Direkt widersprüchliche Einzelstudien je nach CHO-Dosis — vom Paper selbst durch die 1,2 g/kg/h-Schwelle aufgelöst",
      "Position Statement (0,2–0,4 g/kg/h) und Practical Applications (0,2–0,5 g/kg/h) nennen leicht unterschiedliche Protein-Dosisbereiche — beide Werte hier transparent aufgeführt, nicht zu einer Zahl verschmolzen",
    ],
    justification:
      "Wörtlich verifiziert im Abschnitt 'Carbohydrate + protein > Endurance training': 'protein addition augments glycogen recovery when carbohydrate ingestion is <1.2 g/kg/h.'",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_PROTEIN_TIMING_ACUTE_VS_LONGTERM",
    claimType: "EVIDENCE_FINDING",
    topic: "protein_timing_resistance_training",
    statement:
      "Acute studies on pre- vs. post-exercise protein ingestion and MPS are mixed (Tipton et al.: 20g whey immediately before or after produced similar MPS rates). Across three independent longitudinal RCTs with differing designs — Andersen et al. (25g protein blend, 14 weeks, histochemical assessment), Hoffman et al. (42g hydrolyzed collagen, 10 weeks, collegiate football players, DEXA assessment), and Schoenfeld et al. (25g whey isolate, 10 weeks, 3x/week whole-body resistance training, 21 resistance-trained men >1 year experience) — two of three (Hoffman, Schoenfeld) found no significant difference in strength/hypertrophy between pre- and post-exercise protein timing when adequate protein was provided; Andersen found a significant difference, which the source attributes to differing protein source (collagen vs. whey/blend), measurement sensitivity (DEXA vs. histochemistry), and ~20% higher caloric intake in the Andersen protein group versus the Hoffman comparison.",
    population:
      "Krafttrainierte Erwachsene (Schoenfeld: >1 Jahr Erfahrung, n=21; Hoffman: College-Football-Spieler; Andersen: Population im Detail nicht weiter spezifiziert)",
    trainingContext:
      "strukturiertes Widerstandstraining, aggregierte Spanne 10–14 Wochen über drei unterschiedliche Studien (kein einheitliches Protokoll)",
    trainingType: "resistance",
    intensityOrDuration:
      "10–14 Wochen (Andersen: 14, Hoffman: 10, Schoenfeld: 10); Trainingsfrequenz 3x/Woche nur für Schoenfeld explizit angegeben",
    nutritionContext:
      "20–42g Protein-Bolus, Proteinquelle unterschiedlich: Whey-Isolat (Schoenfeld), Protein-Blend (Andersen), hydrolysiertes Kollagen (Hoffman) — NICHT als einheitliches Protokoll zu verstehen",
    timingContext: "unmittelbar vor vs. unmittelbar nach Training",
    direction: "NO_EFFECT",
    evidenceStrength: "MODERATE",
    limitations: [
      "Drei methodisch unterschiedliche Studien (Proteinquelle, Dosis, Messmethode, Trainingsdauer) — Zahlenangaben sind aggregierte Bereiche, kein einheitliches RCT-Protokoll",
      "Andersen-Ausnahme mit plausiblen methodischen Gründen erklärt, nicht ignoriert",
      "Akute MPS-Marker (Tipton) korrelieren laut zitierter Literatur nicht zuverlässig mit tatsächlicher Langzeit-Hypertrophie",
    ],
    justification:
      "Direkt aus 'Protein > Resistance training'; alle drei Studien mit Autorennamen, Dosen, Dauer und Erklärung der Diskrepanz wörtlich verifiziert.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_ANABOLIC_WINDOW_NOT_SUPPORTED",
    claimType: "AUTHOR_INTERPRETATION",
    topic: "post_exercise_anabolic_window",
    statement:
      "Reviews by Aragon and Schoenfeld and by Schoenfeld et al., cited in the source, concluded that when recommended levels of protein are consumed, the effect of timing appears to be, at best, minimal. Muscle remains sensitized to protein ingestion for at least 24 hours following a resistance training bout, leading the cited authors to suggest the relevant timing window may be considerably wider than a narrow post-workout window.",
    population: "Krafttrainierte Erwachsene",
    trainingContext: "Widerstandstraining, adäquate Proteinzufuhr vorausgesetzt",
    trainingType: "resistance",
    intensityOrDuration: null,
    nutritionContext: "adäquate tägliche Proteinzufuhr vorausgesetzt — Bedingung ist zentraler Bestandteil des Claims",
    timingContext: "peri-/post-exercise, generell",
    direction: "NO_EFFECT",
    evidenceStrength: "MODERATE",
    limitations: [
      "Basierend auf einer Synthese zweier zitierter Reviews (Aragon & Schoenfeld; Schoenfeld et al.), nicht auf einer neuen Primäranalyse in diesem Paper",
      "Esmarck et al. (ältere Population, niedrige Proteindosis) zeigte einen Timing-Effekt — Ausnahme ausdrücklich vermerkt",
      "Aussage relativiert NUR ein enges Zeitfenster, behauptet NICHT, dass Timing generell irrelevant ist — peri-workout-Protein und tägliche Gesamtzufuhr bleiben separate, weiterhin relevante Faktoren (siehe KERK17_PROTEIN_AVOID_DELAY, KERK17_PROTEIN_DAILY_TOTAL_PRIORITY)",
    ],
    justification:
      "Wörtlich verifiziert im Abschnitt 'Protein > Resistance training': 'the effect of timing appears to be, at best, minimal... muscles remain sensitized to protein ingestion for at least 24h.'",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_PROTEIN_AVOID_DELAY",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "protein_timing_practical",
    statement:
      "Protein consumption during the peri-workout period is described as a pragmatic and sensible strategy, particularly for athletes performing high volumes of exercise. Not consuming protein post-workout — e.g., waiting for several hours post-exercise — is stated to offer no benefits. This does not imply a narrow mandatory timing window (see KERK17_ANABOLIC_WINDOW_NOT_SUPPORTED); it only cautions against a multi-hour delay.",
    population: "Trainierende Erwachsene, insb. mit hohem Trainingsvolumen",
    trainingContext: "peri-workout, alle Trainingsarten",
    trainingType: null,
    intensityOrDuration: null,
    nutritionContext: "proteinhaltige Mahlzeit/Snack",
    timingContext: "post-exercise, kein exaktes Zeitfenster genannt, nur 'mehrere Stunden Verzögerung' als vermiedenes Extrem",
    direction: "INCREASE",
    evidenceStrength: "LIMITED",
    limitations: [
      "Als 'pragmatic recommendation' formuliert, nicht als Ergebnis einer dedizierten Vergleichsstudie 'Verzögerung über X Stunden vs. sofort'",
      "Kein exaktes Zeitfenster genannt — nicht als 30/60-Minuten-Regel zu interpretieren",
      "Im Zusammenspiel mit KERK17_ANABOLIC_WINDOW_NOT_SUPPORTED zu lesen: dieser Claim behauptet KEIN enges anaboles Fenster, sondern relativiert nur eine mehrstündige Verzögerung",
    ],
    justification:
      "Wörtliches Zitat aus 'Practical applications': 'Not consuming protein post-workout (e.g., waiting for several hours post-exercise) offers no benefits.'",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_PROTEIN_DAILY_TOTAL_PRIORITY",
    claimType: "PRACTICAL_RECOMMENDATION",
    topic: "daily_protein_intake",
    statement:
      "Like carbohydrate, timing-related considerations for protein appear to be of lower priority than the ingestion of optimal amounts of daily protein (1.4–2.0 g/kg/day).",
    population: "Trainierende/sportlich aktive Erwachsene",
    trainingContext: "übergreifend, primär im Kontext Widerstandstraining diskutiert",
    trainingType: null,
    intensityOrDuration: null,
    nutritionContext: "tägliche Gesamtproteinzufuhr, 1,4–2,0 g/kg/Tag",
    timingContext: "täglich, nicht akut",
    direction: "INCREASE",
    evidenceStrength: "MODERATE",
    limitations: [
      "Nicht für die allgemeine, nicht-trainierende Bevölkerung formuliert — Kontext ist durchgehend 'exercising individuals'",
    ],
    justification: "Wörtliches Zitat aus 'Practical applications'.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_PROTEIN_DOSE_PATTERN_MPS",
    claimType: "EVIDENCE_FINDING",
    topic: "protein_dose_distribution",
    statement:
      "In two related short-term studies from the same research group (Moore et al.; Areta et al.), distributing ~20 g protein doses every 3h over a 12-hour post-resistance-exercise window produced higher ACUTE muscle protein synthesis (MPS) marker values than the same total protein given as fewer, larger doses or more, smaller doses. This reflects an acute biomarker response measured over 12 hours, not a demonstrated long-term difference in strength or hypertrophy, and used isolated protein rather than mixed meals.",
    population: "Krafttrainierte Männer",
    trainingContext: "post-resistance-exercise, 12h-Messfenster",
    trainingType: "resistance",
    intensityOrDuration: "12h-Beobachtungsfenster nach einer einzelnen Trainingseinheit",
    nutritionContext: "20g Protein alle 3h (Vergleich zu größeren/selteneren oder kleineren/häufigeren Dosen); isoliertes Protein, keine Mischmahlzeit",
    timingContext: "über 12h verteilt, post-exercise",
    direction: "INCREASE",
    evidenceStrength: "LIMITED",
    limitations: [
      "Ausschließlich akute MPS-Biomarker gemessen, KEINE Kraft-/Hypertrophie-Endpunkte in diesen beiden Studien",
      "Nur 2 zusammenhängende Kurzzeitstudien derselben Forschungsgruppe — keine unabhängige Replikation",
      "MPS-Marker korrelieren laut im Paper zitierter Literatur (Mitchell et al.) nicht zuverlässig mit tatsächlicher Langzeit-Hypertrophie",
      "Isoliertes Protein statt Mischmahlzeiten verabreicht — Paper selbst weist auf abweichende Verdauungskinetik bei Mischmahlzeiten hin",
      "Darf NICHT zu einer allgemeinen '20g alle 3h'-Regel für Kraft-/Hypertrophie-Ziele verallgemeinert werden",
    ],
    justification:
      "Direkt aus 'Timing and distribution of protein feeding'-Abschnitt, Moore und Areta namentlich zitiert.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_MEAL_FREQUENCY_NO_WEIGHTLOSS_EFFECT",
    claimType: "EVIDENCE_FINDING",
    topic: "meal_frequency",
    statement:
      "In studies conducted in non-athletic populations under controlled/isokaloric energy intake, altering meal frequency has shown limited effects on body composition. More consistent evidence exists for an effect on appetite/satiety control.",
    population:
      "Überwiegend nicht-athletische, teils übergewichtige erwachsene Studienpopulationen — NICHT als allgemeine Aussage über Athleten zu verwenden",
    trainingContext: "kalorienrestriktive Diät, überwiegend OHNE begleitende Trainingsintervention",
    trainingType: null,
    intensityOrDuration: null,
    nutritionContext: "isokalorische Diäten mit unterschiedlicher Mahlzeitenanzahl",
    timingContext: "über den Tag verteilte Mahlzeitenanzahl",
    direction: "NO_EFFECT",
    evidenceStrength: "MODERATE",
    limitations: [
      "Datenbasis primär nicht-athletisch/teils übergewichtig — NICHT ohne Weiteres auf trainierte Sportler übertragbar",
      "Ältere, rein beobachtende Studien zeigten eine Assoziation, wurden aber laut Paper von kontrollierten Studien nicht bestätigt",
    ],
    justification:
      "Wörtlich verifiziert aus 'Practical applications': 'altering meal frequency has shown limited effects on body composition'; Population-Einschränkung aus dem Fließtext-Abschnitt 'Meal frequency'.",
    status: "VERIFIED",
  },
  {
    claimId: "KERK17_PRESLEEP_CASEIN",
    claimType: "EVIDENCE_FINDING",
    topic: "pre_sleep_protein",
    statement:
      "30–40 g of casein protein consumed within 30 minutes before sleep acutely increases overnight muscle protein synthesis without impairing lipolysis (Res et al.; Kinsey et al.). Of only two available long-term studies (>4 weeks): Snijders et al. (12 weeks, young trained men, groups not nitrogen-matched — the protein group received ~1.9 vs. ~1.3 g/kg/day total protein) found significantly greater strength/muscle gains; Antonio et al. (8 weeks, nitrogen-matched, subjects already consuming high baseline protein) found no significant difference. This evidence is not sufficient to support a general recommendation to consume casein before sleep — it should be treated as a documented, unresolved research question.",
    population: "Snijders: junge trainierte Männer; Antonio: trainierte Männer/Frauen mit bereits hoher Ausgangs-Proteinzufuhr",
    trainingContext: "begleitendes progressives Widerstandstraining, 3x/Woche",
    trainingType: "resistance",
    intensityOrDuration: "12 Wochen (Snijders) bzw. 8 Wochen (Antonio)",
    nutritionContext: "27,5–40g Casein-Getränk vor dem Schlafen",
    timingContext: "30–90 min vor dem Schlafen",
    direction: "CONDITIONAL",
    evidenceStrength: "LIMITED",
    limitations: [
      "Nur 2 Langzeitstudien insgesamt, mit widersprüchlichem Ergebnis",
      "Snijders-Studie NICHT stickstoffbilanziert (Proteingruppe erhielt insgesamt mehr Gesamtprotein) — Effekt evtl. auf Gesamtmenge statt Timing zurückzuführen",
      "Antonio-Studie: Ausbleiben eines Effekts evtl. durch bereits hohe Basis-Proteinzufuhr der Probanden erklärbar",
      "Effekt ist spezifisch für Casein (langsam verdauliches Protein) untersucht, nicht für Protein allgemein",
      "Nicht ausreichend, um eine allgemeine Coach-Empfehlung 'vor dem Schlafen Casein essen' zu rechtfertigen — nur als dokumentierter, ungeklärter Forschungsbereich zu behandeln",
    ],
    justification:
      "Wörtlich aus 'Pre-sleep protein intake'-Abschnitt; beide Langzeitstudien mit Autorennamen, Dauer und methodischen Einschränkungen verifiziert.",
    status: "VERIFIED",
  },
];
