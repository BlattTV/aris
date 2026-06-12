/**
 * Analyse-Engine: Einzugsgebiet, Kundenpotenzial, Umsatzprognose,
 * Standort-Score und Wettbewerbs-/Kannibalisierungsmodell.
 *
 * Modell:
 *  - Besucherpotenzial: Σ Attraktionen im Radius, Besucher × Distanz-Decay
 *    (Gravitationsmodell, Decay = 1 / (1 + (d/d0)²)) × Verweildauer-Gewicht
 *  - Einwohnerpotenzial: Σ Bevölkerung im Radius × Decay × Kauffrequenz
 *  - Capture-Rate: Anteil der Passanten, die tatsächlich kaufen
 *  - Wettbewerb: vorhandene Automaten teilen das Potenzial anteilig
 *    nach Nähe zum Analysepunkt auf (eigener Automat am Punkt = 1 Anteil)
 */
import { SEASONALITY } from "./data.js";
import { state, allAttractions, allMachines, subscribe } from "./store.js";
import { haversineKm } from "./queries.mjs";

// Kalibrierung neu berechnen, sobald sich Standorte/Parameter ändern
subscribe((topic) => {
  if (["machines", "settings", "import"].includes(topic)) invalidateCalibration();
});

export { haversineKm };

const D0_KM = 0.8; // Halbwertsdistanz des Gravitations-Decays

function decay(dKm) {
  return 1 / (1 + (dKm / D0_KM) ** 2);
}

function seasonFactor(cat) {
  if (!state.settings.applySeasonality) return 1;
  const month = new Date().getMonth();
  const row = SEASONALITY[cat];
  return row ? row[month] : 1;
}

// Verweildauer erhöht Kaufwahrscheinlichkeit (60 min = Referenz, gedeckelt)
function dwellWeight(dwellMin) {
  return Math.min(1.6, Math.sqrt((dwellMin || 60) / 60));
}

// ---------- Auto-Kalibrierung aus Ist-Umsätzen ----------
// Vergleicht reale Umsätze eigener Standorte mit der Modellprognose und
// skaliert das Modell (Median der Verhältnisse, begrenzt auf 0,25–4).

let calibrationCache = null;
export function invalidateCalibration() {
  calibrationCache = null;
}

function machineAnnualActual(m) {
  if (m.salesHistory?.length) {
    return (m.salesHistory.reduce((s, h) => s + h.eur, 0) / m.salesHistory.length) * 12;
  }
  return m.monthlySalesEur ? m.monthlySalesEur * 12 : 0;
}

export function computeCalibration() {
  if (!state.settings.autoCalibrate) return { factor: 1, samples: 0 };
  if (calibrationCache) return calibrationCache;
  const ratios = [];
  for (const m of state.machines.filter((x) => !x.isCompetitor)) {
    const actual = machineAnnualActual(m);
    if (!actual) continue;
    const predicted = analyzePoint(m.lat, m.lng, undefined, { raw: true }).revenueYear;
    if (predicted > 100) ratios.push(actual / predicted);
  }
  let factor = 1;
  if (ratios.length) {
    ratios.sort((a, b) => a - b);
    factor = ratios[(ratios.length - 1) >> 1];
    factor = Math.max(0.25, Math.min(4, factor));
  }
  calibrationCache = { factor, samples: ratios.length };
  return calibrationCache;
}

/**
 * Vollanalyse für einen Punkt.
 * @param opts.raw  true = ohne Kalibrierung (intern, verhindert Rekursion)
 * @returns {object} Kennzahlen inkl. Beiträgen je Attraktion
 */
export function analyzePoint(lat, lng, radiusKm = state.settings.radiusKm, opts = {}) {
  const s = state.settings;

  // 1. Besucherströme aus Attraktionen
  let visitorPotentialYear = 0;
  const contributions = [];
  for (const a of allAttractions()) {
    const d = haversineKm(lat, lng, a.lat, a.lng);
    if (d > radiusKm) continue;
    const eff =
      a.visitors * decay(d) * dwellWeight(a.dwellMin) * seasonFactor(a.cat);
    visitorPotentialYear += eff;
    contributions.push({ attraction: a, distanceKm: d, effectiveVisitors: eff });
  }
  contributions.sort((x, y) => y.effectiveVisitors - x.effectiveVisitors);

  // 2. Einwohner im Einzugsgebiet. Liegt Zensus-Raster im Radius, zählt
  //    nur dieses (präziser; verhindert Doppelzählung mit place-Nodes).
  let residentsInRange = 0;
  let residentPurchasesYear = 0;
  const inRange = state.populationCenters
    .map((p) => ({ p, d: haversineKm(lat, lng, p.lat, p.lng) }))
    .filter((x) => x.d <= radiusKm);
  const hasZensus = inRange.some((x) => x.p.source === "zensus");
  for (const { p, d } of inRange) {
    if (hasZensus && p.source !== "zensus") continue;
    const reach = p.pop * decay(d);
    residentsInRange += reach;
    residentPurchasesYear += reach * s.residentBuysPerYear;
  }

  // 2b. Veranstaltungen (Kalender): zeitlich begrenzte Besucherströme
  const today = new Date().toISOString().slice(0, 10);
  let eventCustomersYear = 0;
  let eventCustomersDayNow = 0;
  const activeEvents = [];
  for (const ev of state.events || []) {
    const d = haversineKm(lat, lng, ev.lat, ev.lng);
    if (d > radiusKm) continue;
    const days = Math.max(1,
      (Date.parse(ev.to) - Date.parse(ev.from)) / 86400000 + 1);
    const captured = ev.visitors * decay(d) * (s.captureRatePct / 100);
    eventCustomersYear += captured; // Gesamtbesucher wirken einmal pro Jahr
    if (today >= ev.from && today <= ev.to) {
      eventCustomersDayNow += captured / days;
      activeEvents.push({ ...ev, distanceKm: d });
    }
  }

  // 3. Wettbewerb: Automaten im Radius teilen das Potenzial
  const competitors = allMachines()
    .map((m) => ({ m, d: haversineKm(lat, lng, m.lat, m.lng) }))
    .filter((x) => x.d <= radiusKm);
  // Anteilsmodell: eigener (geplanter) Automat hat Gewicht 1,
  // jeder bestehende Automat Gewicht decay(d) relativ zum Analysepunkt.
  const competitorWeight = competitors.reduce((sum, x) => sum + decay(x.d), 0);
  const share = 1 / (1 + competitorWeight);

  // 4. Kundenzahlen & Umsatz (inkl. Kalibrierung aus Ist-Umsätzen)
  const calibration = opts.raw ? { factor: 1, samples: 0 } : computeCalibration();
  const grossCustomersYear =
    (visitorPotentialYear * (s.captureRatePct / 100) +
      residentPurchasesYear * 0.15 +
      eventCustomersYear) * calibration.factor;
  const customersYear = grossCustomersYear * share;
  const customersDay = customersYear / 365 + eventCustomersDayNow * share * calibration.factor;
  const revenueYear = customersYear * s.avgTicketEur;
  const grossProfitYear = revenueYear * (s.marginPct / 100);
  const opexYear = s.opexPerMachineMonth * 12;
  const netProfitYear = grossProfitYear - opexYear;

  // 5. Score 0–100 (logarithmisch, 30 Kunden/Tag ≈ 100)
  const score = Math.round(
    Math.max(0, Math.min(100, (Math.log10(Math.max(1, customersDay)) / Math.log10(30)) * 100))
  );

  return {
    point: { lat, lng },
    radiusKm,
    visitorPotentialYear,
    residentsInRange,
    competitors: competitors.map((x) => ({ ...x.m, distanceKm: x.d })),
    marketShare: share,
    customersDay,
    customersYear,
    revenueYear,
    grossProfitYear,
    opexYear,
    netProfitYear,
    breakEven: netProfitYear > 0,
    score,
    contributions,
    activeEvents,
    eventCustomersYear,
    calibration,
  };
}

/**
 * Raster-Scoring über das Kartengebiet für die Potenzial-Heatmap.
 * Liefert [{lat,lng,score}] – bewusst grob (Performance im Browser).
 */
export function scoreGrid(bounds, stepKm = 1.0, radiusKm = state.settings.radiusKm) {
  const out = [];
  const latStep = stepKm / 111;
  const midLat = (bounds.south + bounds.north) / 2;
  const lngStep = stepKm / (111 * Math.cos((midLat * Math.PI) / 180));
  for (let lat = bounds.south; lat <= bounds.north; lat += latStep) {
    for (let lng = bounds.west; lng <= bounds.east; lng += lngStep) {
      const r = analyzePoint(lat, lng, radiusKm);
      if (r.score > 5) out.push({ lat, lng, score: r.score, customersDay: r.customersDay });
    }
  }
  return out;
}

/**
 * Top-Standortvorschläge: beste Rasterpunkte mit Mindestabstand zueinander.
 */
export function suggestLocations(bounds, count = 5) {
  const grid = scoreGrid(bounds, 0.7);
  grid.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const g of grid) {
    if (picked.every((p) => haversineKm(p.lat, p.lng, g.lat, g.lng) > 1.5)) {
      picked.push(g);
      if (picked.length >= count) break;
    }
  }
  return picked;
}

export function fmtNum(n, digits = 0) {
  return new Intl.NumberFormat("de-DE", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

export function fmtEur(n) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}
