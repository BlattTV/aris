/**
 * Datenprovider des Clients – zwei Betriebsarten:
 *
 *  - "server": Die App läuft hinter dem mitgelieferten Node-Server
 *    (LXC-Hosting). Automaten/Hofläden (farmshops-Datenmodell) und
 *    Bevölkerung kommen aus dem nächtlich vorgeladenen Deutschland-
 *    Datenbestand, POIs aus dem Server-Tile-Cache.
 *  - "direct": Statisches Hosting ohne Backend. Daten werden je
 *    Kartenausschnitt direkt von der Overpass-API geladen.
 *
 * Geladen wird viewport-basiert (deutschlandweit), dedupliziert in den
 * Store gemerged und periodisch aufgefrischt.
 */
import { OVERPASS_URL, buildBboxQuery, parseElements } from "./queries.mjs";
import { state, mergeFetched, persist, notify } from "./store.js";

let mode = "direct";
let serverStatus = null;
const fetchedTiles = new Map(); // key -> timestamp, verhindert Mehrfach-Abrufe

export function getMode() {
  return mode;
}

export function getServerStatus() {
  return serverStatus;
}

export async function detectMode() {
  try {
    const res = await fetch("api/status", { cache: "no-store" });
    if (res.ok) {
      serverStatus = await res.json();
      mode = "server";
    }
  } catch {
    mode = "direct";
  }
  notify("mode");
  return mode;
}

// Kartenausschnitte größer als das werden nicht geladen (erst hineinzoomen)
const MAX_SPAN_LAT = 1.5;
const MAX_SPAN_LNG = 2.5;
const TILE_TTL_MS = 60 * 60 * 1000; // Ausschnitt frühestens nach 1 h erneut laden

function tileKey(bbox) {
  const q = (x) => (Math.round(x * 10) / 10).toFixed(1);
  return [q(bbox.s), q(bbox.w), q(bbox.n), q(bbox.e)].join("|");
}

/**
 * Daten für den aktuellen Kartenausschnitt (plus Analyse-Radius) laden.
 * @returns {"ok"|"tooLarge"|"cached"|"error"}
 */
export async function loadViewport(bounds, { force = false } = {}) {
  const padDeg = Math.max(0.02, state.settings.radiusKm / 111);
  const bbox = {
    s: bounds.getSouth() - padDeg,
    w: bounds.getWest() - padDeg,
    n: bounds.getNorth() + padDeg,
    e: bounds.getEast() + padDeg,
  };
  if (bbox.n - bbox.s > MAX_SPAN_LAT || bbox.e - bbox.w > MAX_SPAN_LNG) {
    notify("data:toolarge");
    return "tooLarge";
  }

  const key = tileKey(bbox);
  const last = fetchedTiles.get(key);
  if (!force && last && Date.now() - last < TILE_TTL_MS) return "cached";

  notify("data:loading");
  try {
    let data;
    if (mode === "server") {
      const j = async (url) => {
        const r = await fetch(url);
        if (r.status === 401 || r.status === 403) {
          notify("auth:required");
          throw new Error("Anmeldung/Lizenz erforderlich");
        }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      };
      const q = `bbox=${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
      const [machines, pois, population] = await Promise.all([
        j(`api/machines?${q}`),
        j(`api/pois?${q}`),
        j(`api/population?${q}`),
      ]);
      data = { machines, pois, population };
    } else {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        body: "data=" + encodeURIComponent(buildBboxQuery(bbox)),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) throw new Error("Overpass HTTP " + res.status);
      data = parseElements((await res.json()).elements);
    }
    fetchedTiles.set(key, Date.now());
    mergeFetched(data);
    state.lastRefresh = new Date().toISOString();
    persist();
    notify("data:done");
    return "ok";
  } catch (e) {
    console.warn("Datenladen fehlgeschlagen:", e);
    notify("data:error");
    return "error";
  }
}

/** Manuelle Aktualisierung: Caches leeren, Server-Update anstoßen, neu laden. */
export async function refreshNow(bounds) {
  fetchedTiles.clear();
  if (mode === "server") {
    try {
      await fetch("api/refresh", { method: "POST" });
      serverStatus = await (await fetch("api/status", { cache: "no-store" })).json();
    } catch (e) {
      console.warn("Server-Refresh fehlgeschlagen:", e);
    }
  }
  return loadViewport(bounds, { force: true });
}

let timer = null;

/** Periodisches Auffrischen des aktuellen Ausschnitts gemäß Einstellungen. */
export function scheduleAutoRefresh(getBounds) {
  if (timer) clearInterval(timer);
  const hours = state.settings.autoRefreshHours;
  if (!hours) return;
  timer = setInterval(() => {
    const ageH = state.lastRefresh
      ? (Date.now() - new Date(state.lastRefresh).getTime()) / 36e5
      : Infinity;
    if (ageH >= hours) {
      fetchedTiles.clear();
      loadViewport(getBounds(), { force: true });
    }
  }, 30 * 60 * 1000);
}

/** Ortssuche (Nominatim, deutschlandweit). */
export async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&countrycodes=de&limit=1&q=" +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("Geocoding HTTP " + res.status);
  const hits = await res.json();
  if (!hits.length) return null;
  return { lat: Number(hits[0].lat), lng: Number(hits[0].lon), name: hits[0].display_name };
}
