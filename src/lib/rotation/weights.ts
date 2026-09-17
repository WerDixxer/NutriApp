/**
 * Zentral definierte Punktwerte für das Rotation-Scoring (siehe factors.ts),
 * damit keine Zahl verstreut im Code auftaucht. Additiv statt 0..1-normiert,
 * weil Dringlichkeit hier eine offene Skala ist (ein Item kann beliebig
 * "dringend" sein), kein Vergleich zwischen einer festen Kandidatenmenge wie
 * bei der Decision Engine.
 *
 * Rangfolge der Gewichte spiegelt die vorgegebene Priorität wider: Ablauf
 * dominiert klar, geöffnet/gekocht/Restmenge sind sekundäre, aber spürbare
 * Signale, Alter und Lagerort sind milde Signale (siehe Kapitel-Auftrag,
 * Abschnitt 2). "Opened" darf dadurch nie ein unmittelbar ablaufendes,
 * ungeöffnetes Produkt überstimmen: selbst der volle `openedPoints`-Wert
 * bleibt unter jedem Ablauf-Tier ab "läuft in wenigen Tagen ab".
 */
export const ROTATION_WEIGHTS = {
  expiredPoints: 100,
  expiresTodayPoints: 80,
  expiresFewDaysPoints: 60,
  expiresWeekPoints: 30,
  expiresLaterPoints: 5,
  /** Ein geschätztes Datum wird "weniger hart" interpretiert als ein exaktes, siehe Kapitel-Auftrag Abschnitt 2B. */
  estimatedMultiplier: 0.7,
  openedPoints: 25,
  /** Gekochte Reste stärker gewichtet als bloß geöffnet, siehe Abschnitt 2D ("stark priorisieren"). */
  cookedPoints: 35,
  smallRemainingPoints: 20,
  /** "Kleine Restmenge" = Rest höchstens so viel Anteil der ursprünglichen Menge. */
  smallRemainingRatio: 0.25,
  longPresentPoints: 10,
  longPresentDays: 14,
  /**
   * Sehr milder Lagerort-Hinweis (geöffnetes Kühlschrank-Item bekommt etwas
   * mehr Aufmerksamkeit), bewusst OHNE Reason-Text, um keine Haltbarkeits-
   * oder Lebensmittelsicherheits-Behauptung zu formulieren (Abschnitt 2G/11).
   */
  fridgeOpenedBonusPoints: 5,
} as const;

/** Tage bis Ablauf, die einen Tier-Wechsel auslösen (siehe factors.ts). */
export const EXPIRY_TIER_DAYS = {
  today: 0,
  fewDaysMax: 2,
  weekMax: 7,
} as const;

/** Schwellenwerte für die priorityScore -> urgency Abbildung, siehe rotationEngine.ts. */
export const URGENCY_THRESHOLDS = {
  critical: 80,
  high: 50,
  medium: 20,
} as const;
