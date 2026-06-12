/**
 * Routenoptimierung für Befüllungs-/Servicetouren: Travelling-Salesman-
 * Heuristik (Nearest Neighbour + 2-Opt) über die eigenen Standorte.
 */
import { haversineKm } from "./queries.mjs";

const AVG_SPEED_KMH = 38;     // Ø Fahrgeschwindigkeit (Stadt/Land gemischt)
const SERVICE_MIN = 12;       // Standzeit je Stopp (Befüllung)

/**
 * @param stops   [{lat,lng,name,...}] zu besuchende Standorte
 * @param start   {lat,lng} Startpunkt (Depot); Rückkehr zum Start
 * @returns {order, distanceKm, driveMin, serviceMin, totalMin}
 */
export function planRoute(stops, start) {
  if (!stops.length) return null;
  const pts = [{ ...start, name: "Depot/Start", isStart: true }, ...stops.map((s) => ({ ...s }))];
  const n = pts.length;
  const dist = (a, b) => haversineKm(pts[a].lat, pts[a].lng, pts[b].lat, pts[b].lng);

  // Nearest Neighbour ab Start
  const visited = new Array(n).fill(false);
  const tour = [0];
  visited[0] = true;
  while (tour.length < n) {
    const last = tour[tour.length - 1];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && dist(last, i) < bestD) { bestD = dist(last, i); best = i; }
    }
    tour.push(best);
    visited[best] = true;
  }

  // 2-Opt-Verbesserung (Rundtour, Start fix an Position 0)
  const tourLen = (t) => {
    let d = 0;
    for (let i = 0; i < t.length; i++) d += dist(t[i], t[(i + 1) % t.length]);
    return d;
  };
  let improved = true, guard = 0;
  while (improved && guard++ < 60) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const a = tour[i - 1], b = tour[i], c = tour[k], d2 = tour[(k + 1) % n];
        const delta = dist(a, c) + dist(b, d2) - dist(a, b) - dist(c, d2);
        if (delta < -1e-9) {
          // Segment i..k umkehren
          let lo = i, hi = k;
          while (lo < hi) { [tour[lo], tour[hi]] = [tour[hi], tour[lo]]; lo++; hi--; }
          improved = true;
        }
      }
    }
  }

  const distanceKm = tourLen(tour);
  const driveMin = (distanceKm / AVG_SPEED_KMH) * 60;
  const serviceMin = stops.length * SERVICE_MIN;
  return {
    order: tour.map((i) => pts[i]),
    distanceKm,
    driveMin,
    serviceMin,
    totalMin: driveMin + serviceMin,
  };
}
