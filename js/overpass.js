/**
 * Automatische Datenaktualisierung über die OpenStreetMap Overpass-API.
 * Lädt reale POIs (Tourismus, Freizeit, Bäder, Einkaufszentren, bestehende
 * Verkaufsautomaten) im Umkreis von Coburg und schätzt Besucherzahlen
 * heuristisch nach POI-Typ. Läuft periodisch gemäß Einstellungen.
 */
import { state, persist, notify } from "./store.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CENTER = { lat: 50.2585, lng: 10.9645 }; // Coburg Marktplatz
const RADIUS_M = 30000;

// Heuristische Jahresbesucher je OSM-Typ (konservative Schätzungen)
const VISITOR_ESTIMATES = {
  museum: 12000, gallery: 8000, castle: 25000, attraction: 15000,
  theme_park: 80000, zoo: 60000, viewpoint: 8000,
  water_park: 120000, swimming_pool: 40000, sports_centre: 30000,
  stadium: 40000, mall: 600000, theatre: 30000, cinema: 90000,
};

const QUERY = `
[out:json][timeout:30];
(
  node["tourism"~"museum|gallery|attraction|theme_park|zoo|viewpoint"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  way["tourism"~"museum|gallery|attraction|theme_park|zoo"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  node["leisure"~"water_park|sports_centre|stadium"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  way["leisure"~"water_park|sports_centre|stadium"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  node["amenity"~"theatre|cinema"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  node["shop"="mall"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  way["shop"="mall"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  node["amenity"="vending_machine"]["vending"~"food|drinks|sweets|pizza|ice_cream|coffee"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
);
out center tags;
`;

function classify(tags) {
  const t = tags.tourism || tags.leisure || tags.amenity || tags.shop;
  const catMap = {
    museum: "kultur", gallery: "kultur", castle: "kultur", theatre: "kultur",
    attraction: "freizeit", theme_park: "freizeit", zoo: "freizeit", cinema: "freizeit",
    viewpoint: "natur", water_park: "therme", swimming_pool: "therme",
    sports_centre: "sport", stadium: "sport", mall: "einkauf",
  };
  return { type: t, cat: catMap[t] || "freizeit", visitors: VISITOR_ESTIMATES[t] || 10000 };
}

export async function refreshFromOverpass() {
  notify("refresh:start");
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: "data=" + encodeURIComponent(QUERY),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) throw new Error("Overpass HTTP " + res.status);
  const json = await res.json();

  const knownNames = new Set(
    state.attractions.map((a) => a.name.toLowerCase().slice(0, 12))
  );
  const pois = [];
  const foundVendingMachines = [];

  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || !tags.name) {
      if (tags.amenity === "vending_machine" && lat != null) {
        foundVendingMachines.push({ lat, lng, vending: tags.vending || "?" });
      }
      continue;
    }
    if (tags.amenity === "vending_machine") {
      foundVendingMachines.push({ lat, lng, vending: tags.vending || "?", name: tags.name });
      continue;
    }
    // Dubletten mit kuratierten Daten vermeiden
    if (knownNames.has(tags.name.toLowerCase().slice(0, 12))) continue;
    const c = classify(tags);
    pois.push({
      id: "osm-" + el.type + el.id,
      name: tags.name,
      cat: c.cat,
      lat, lng,
      visitors: c.visitors,
      dwellMin: 60,
      source: "osm",
      osmType: c.type,
      updated: new Date().toISOString().slice(0, 10),
    });
  }

  state.overpassPois = pois;
  state.lastRefresh = new Date().toISOString();
  persist();
  notify("refresh:done");
  return { pois: pois.length, vendingMachines: foundVendingMachines };
}

let timer = null;

export function scheduleAutoRefresh() {
  if (timer) clearInterval(timer);
  const hours = state.settings.autoRefreshHours;
  if (!hours) return;

  const due = () => {
    if (!state.lastRefresh) return true;
    const ageH = (Date.now() - new Date(state.lastRefresh).getTime()) / 36e5;
    return ageH >= hours;
  };

  const tick = () => {
    if (due()) refreshFromOverpass().catch((e) => console.warn("Auto-Refresh fehlgeschlagen:", e));
  };
  tick(); // sofort prüfen
  timer = setInterval(tick, 30 * 60 * 1000); // alle 30 min prüfen
}
