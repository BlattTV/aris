/**
 * Automatische Datenaktualisierung über die OpenStreetMap Overpass-API.
 *
 * Lädt im Umkreis von Coburg:
 *  1. Frequenzbringer-POIs (Tourismus, Freizeit, Bäder, Arenen, Kinos,
 *     Einkaufszentren) mit heuristischen Besucherzahlen.
 *  2. Das komplette farmshops.eu-Datenmodell – farmshops.eu ist selbst
 *     nur eine Aufbereitung von OpenStreetMap-Daten (Quelle:
 *     github.com/CodeforKarlsruhe/farmshops.eu, update_data.js):
 *       - Verkaufsautomaten (vending = milk/egg/food/cheese/meat/… sowie
 *         klassische Snack-/Getränkeautomaten), ohne Tierfutter
 *       - Hofläden (shop=farm), Wochenmärkte (amenity=marketplace),
 *         Imkereien (craft=beekeeper)
 *     Automaten werden als Wettbewerber in die Berechnung übernommen,
 *     Hofläden/Märkte als Frequenzbringer.
 *
 * Läuft periodisch gemäß Einstellungen (Standard: täglich).
 */
import { state, persist, notify } from "./store.js";
import { haversineKm } from "./analysis.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const CENTER = { lat: 50.2585, lng: 10.9645 }; // Coburg Marktplatz
const RADIUS_M = 30000;

// Heuristische Jahresbesucher je OSM-Typ (konservative Schätzungen)
const VISITOR_ESTIMATES = {
  museum: 12000, gallery: 8000, castle: 25000, attraction: 15000,
  theme_park: 80000, zoo: 60000, viewpoint: 8000,
  water_park: 120000, swimming_pool: 40000, sports_centre: 30000,
  stadium: 40000, mall: 600000, theatre: 30000, cinema: 90000,
  farm: 8000, marketplace: 60000, beekeeper: 2000,
};

// vending-Werte wie bei farmshops.eu plus klassische Snack-/Getränkeautomaten
const VENDING_REGEX =
  "milk|egg|food|cheese|sausage|meat|potato|noodle|tomato|honey|fruit|bread|" +
  "drinks|sweets|pizza|ice_cream|coffee|farm";

const VENDING_LABELS = {
  milk: "Milchtankstelle", egg: "Eierautomat", eggs: "Eierautomat",
  food: "Lebensmittelautomat", cheese: "Käseautomat", sausage: "Wurstautomat",
  meat: "Fleischautomat", potato: "Kartoffelautomat", noodle: "Nudelautomat",
  tomato: "Gemüseautomat", honey: "Honigautomat", fruit: "Obstautomat",
  bread: "Brotautomat", drinks: "Getränkeautomat", sweets: "Snackautomat",
  pizza: "Pizzaautomat", ice_cream: "Eisautomat", coffee: "Kaffeeautomat",
  farm: "Hofautomat",
};

const QUERY = `
[out:json][timeout:45];
(
  nwr["tourism"~"museum|gallery|attraction|theme_park|zoo|viewpoint"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["leisure"~"water_park|sports_centre|stadium"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["amenity"~"theatre|cinema"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["shop"="mall"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["amenity"="vending_machine"]["vending"~"${VENDING_REGEX}"]["vending"!~"animal_food"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["shop"="farm"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["amenity"="marketplace"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
  nwr["craft"="beekeeper"](around:${RADIUS_M},${CENTER.lat},${CENTER.lng});
);
out center tags;
`;

function classify(tags) {
  const t =
    tags.shop === "farm" ? "farm" :
    tags.craft === "beekeeper" ? "beekeeper" :
    tags.tourism || tags.leisure || tags.amenity || tags.shop;
  const catMap = {
    museum: "kultur", gallery: "kultur", castle: "kultur", theatre: "kultur",
    attraction: "freizeit", theme_park: "freizeit", zoo: "freizeit", cinema: "freizeit",
    viewpoint: "natur", water_park: "therme", swimming_pool: "therme",
    sports_centre: "sport", stadium: "sport", mall: "einkauf",
    farm: "regional", marketplace: "regional", beekeeper: "regional",
  };
  return { type: t, cat: catMap[t] || "freizeit", visitors: VISITOR_ESTIMATES[t] || 10000 };
}

function vendingLabel(vending) {
  const first = String(vending || "").split(";")[0].trim();
  return VENDING_LABELS[first] || "Verkaufsautomat";
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
  const machines = [];

  for (const el of json.elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null) continue;

    // Automaten → Wettbewerber-Datenbestand (farmshops.eu-Modell)
    if (tags.amenity === "vending_machine") {
      const label = vendingLabel(tags.vending);
      // Dublette: manuell erfasster Automat in < 50 m Entfernung
      const isManualDupe = state.machines.some(
        (m) => haversineKm(lat, lng, m.lat, m.lng) < 0.05
      );
      if (isManualDupe) continue;
      machines.push({
        id: "osm-" + el.type + el.id,
        name: tags.name || label,
        type: label,
        lat, lng,
        isCompetitor: true,
        operator: tags.operator || "",
        vending: tags.vending || "",
        note: tags.operator ? "Betreiber: " + tags.operator : "",
        source: "osm",
        installedAt: new Date().toISOString().slice(0, 10),
      });
      continue;
    }

    // POIs benötigen einen Namen; Dubletten mit kuratierten Daten vermeiden
    if (!tags.name) continue;
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
  state.osmMachines = machines;
  state.lastRefresh = new Date().toISOString();
  persist();
  notify("refresh:done");
  return { pois: pois.length, machines: machines.length };
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
