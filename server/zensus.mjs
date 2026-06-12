/**
 * Zensus-Bevölkerungsraster: Laden und Bbox-Abfragen mit adaptiver
 * Aggregation. Datenbestand (data/zensus.json) wird mit
 * server/import-zensus.mjs aus dem offenen Zensus-2022-100m-Gitter erzeugt.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

let cells = null;          // [[lat,lng,pop], ...]
let buckets = new Map();   // "latIdx|lngIdx" (0,1°) -> [cellIndex...]

export async function loadZensus(dataDir, log) {
  try {
    const json = JSON.parse(await fs.readFile(path.join(dataDir, "zensus.json"), "utf8"));
    cells = json.cells || [];
    buckets = new Map();
    cells.forEach(([lat, lng], i) => {
      const key = `${Math.floor(lat * 10)}|${Math.floor(lng * 10)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(i);
    });
    log(`Zensus-Raster geladen: ${cells.length} Zellen (${json.resolutionM || "?"} m, Stand ${json.generatedAt || "?"})`);
  } catch {
    cells = null;
    log("Kein Zensus-Raster vorhanden (optional) – Bevölkerung kommt aus OSM-place-Nodes. " +
        "Import: node server/import-zensus.mjs <csv>");
  }
}

export const zensusAvailable = () => !!cells && cells.length > 0;

const MAX_CELLS = 4000;

/** Zellen in der Bbox, bei Bedarf zu gröberem Raster aggregiert. */
export function queryZensus(bbox) {
  if (!zensusAvailable()) return null;
  const hits = [];
  for (let la = Math.floor(bbox.s * 10); la <= Math.floor(bbox.n * 10); la++) {
    for (let lo = Math.floor(bbox.w * 10); lo <= Math.floor(bbox.e * 10); lo++) {
      for (const i of buckets.get(`${la}|${lo}`) || []) {
        const [lat, lng] = cells[i];
        if (lat >= bbox.s && lat <= bbox.n && lng >= bbox.w && lng <= bbox.e) hits.push(i);
      }
    }
  }
  // Adaptive Aggregation: Raster vergröbern, bis die Antwort handhabbar ist
  let factor = 1;
  let result = hits.map((i) => cells[i]);
  while (result.length > MAX_CELLS) {
    factor *= 2;
    const agg = new Map();
    for (const i of hits) {
      const [lat, lng, pop] = cells[i];
      const q = 0.01 * factor; // 1-km-Basisraster ≈ 0,01°
      const key = `${Math.round(lat / q)}|${Math.round(lng / q)}`;
      const e = agg.get(key) || { lat: 0, lng: 0, pop: 0, n: 0 };
      e.lat += lat; e.lng += lng; e.pop += pop; e.n++;
      agg.set(key, e);
    }
    result = [...agg.values()].map((e) => [e.lat / e.n, e.lng / e.n, e.pop]);
  }
  return result.map(([lat, lng, pop], i) => ({
    id: `zensus-${factor}-${i}`,
    name: factor > 1 ? `Zensus-Raster (${factor} km)` : "Zensus-Raster (1 km)",
    lat, lng, pop,
    source: "zensus",
  }));
}

// ---------- Projektion EPSG:3035 (ETRS89-LAEA) → WGS84 ----------
// Inverse Lambert-Azimutal-Flächentreu, ellipsoidisch nach Snyder (1987).
// GRS80: a=6378137, e² = 0.00669438002290; Zentrum 52°N 10°E,
// false easting 4 321 000 m, false northing 3 210 000 m.

const A = 6378137;
const E2 = 0.00669438002290;
const E = Math.sqrt(E2);
const LAT0 = (52 * Math.PI) / 180;
const LON0 = (10 * Math.PI) / 180;
const FE = 4321000;
const FN = 3210000;

function qOf(phi) {
  const s = Math.sin(phi);
  return (1 - E2) * (s / (1 - E2 * s * s) - (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
}

const QP = qOf(Math.PI / 2);
const RQ = A * Math.sqrt(QP / 2);
const BETA0 = Math.asin(qOf(LAT0) / QP);
const M0 = Math.cos(LAT0) / Math.sqrt(1 - E2 * Math.sin(LAT0) ** 2);
const D = (A * M0) / (RQ * Math.cos(BETA0));

/** EPSG:3035-Koordinaten (m) → {lat, lng} in Grad. */
export function laeaToWgs84(x, y) {
  const xp = x - FE;
  const yp = y - FN;
  const rho = Math.hypot(xp / D, D * yp);
  if (rho < 1e-9) return { lat: 52, lng: 10 };
  const ce = 2 * Math.asin(Math.min(1, rho / (2 * RQ)));
  const q = QP * (Math.cos(ce) * Math.sin(BETA0) + (D * yp * Math.sin(ce) * Math.cos(BETA0)) / rho);
  const lng = LON0 + Math.atan2(
    xp * Math.sin(ce),
    D * rho * Math.cos(BETA0) * Math.cos(ce) - D * D * yp * Math.sin(BETA0) * Math.sin(ce)
  );
  // Breitengrad iterativ aus q (Snyder 3-12)
  let phi = Math.asin(Math.max(-1, Math.min(1, q / 2)));
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(phi);
    const corr = ((1 - E2 * s * s) ** 2 / (2 * Math.cos(phi))) *
      (q / (1 - E2) - s / (1 - E2 * s * s) +
        (1 / (2 * E)) * Math.log((1 - E * s) / (1 + E * s)));
    phi += corr;
    if (Math.abs(corr) < 1e-12) break;
  }
  return { lat: (phi * 180) / Math.PI, lng: (lng * 180) / Math.PI };
}
