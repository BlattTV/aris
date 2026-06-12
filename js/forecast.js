/**
 * Umsatz-Forecasting aus Ist-Daten: lineare Regression über die
 * Monatsumsätze (Plan/Ist-Erfassung je Standort ist die Datenbasis).
 */

export function linearRegression(points) {
  // points: [{x, y}]
  const n = points.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

function nextMonth(month) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m ist 0-basiert → +1 Monat
  return d.toISOString().slice(0, 7);
}

/** Jahres-Ist eines Standorts (Ø Monat × 12) aus der Umsatzhistorie. */
export function machineAnnualActual(m) {
  if (m.salesHistory?.length) {
    const avg = m.salesHistory.reduce((s, h) => s + h.eur, 0) / m.salesHistory.length;
    return avg * 12;
  }
  return m.monthlySalesEur ? m.monthlySalesEur * 12 : 0;
}

/**
 * Portfolio-Forecast: Monatssummen über alle Standorte mit Historie,
 * Regression darüber, Prognose für die nächsten Monate.
 * @returns {actual:[{month,eur}], forecast:[{month,eur}], trendPctPerMonth} | null
 */
export function portfolioForecast(machines, horizonMonths = 6) {
  const byMonth = new Map();
  for (const m of machines) {
    for (const h of m.salesHistory || []) {
      byMonth.set(h.month, (byMonth.get(h.month) || 0) + h.eur);
    }
  }
  const actual = [...byMonth.entries()]
    .map(([month, eur]) => ({ month, eur }))
    .sort((a, b) => a.month.localeCompare(b.month));
  if (actual.length < 2) return null;

  const reg = linearRegression(actual.map((a, i) => ({ x: i, y: a.eur })));
  if (!reg) return null;

  const forecast = [];
  let month = actual[actual.length - 1].month;
  for (let i = 1; i <= horizonMonths; i++) {
    month = nextMonth(month);
    forecast.push({ month, eur: Math.max(0, reg.intercept + reg.slope * (actual.length - 1 + i)) });
  }
  const avg = actual.reduce((s, a) => s + a.eur, 0) / actual.length;
  return {
    actual,
    forecast,
    trendPctPerMonth: avg > 0 ? (reg.slope / avg) * 100 : 0,
  };
}
