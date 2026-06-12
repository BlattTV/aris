/**
 * Gemeinsame Overpass-Abfragen und Datenaufbereitung für Client UND Server
 * (reines ESM ohne Browser-/Node-Spezifika).
 *
 * Datenmodell wie farmshops.eu (selbst eine OSM-Aufbereitung,
 * github.com/CodeforKarlsruhe/farmshops.eu) plus Frequenzbringer-POIs
 * und Bevölkerungsdaten aus OSM-place-Nodes.
 */

export const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Heuristische Jahresbesucher je OSM-Typ (konservative Schätzungen)
export const VISITOR_ESTIMATES = {
  museum: 12000, gallery: 8000, castle: 25000, attraction: 15000,
  theme_park: 80000, zoo: 60000, viewpoint: 8000,
  water_park: 120000, swimming_pool: 40000, sports_centre: 30000,
  stadium: 40000, mall: 600000, theatre: 30000, cinema: 90000,
  farm: 8000, marketplace: 60000, beekeeper: 2000,
};

// vending-Werte wie bei farmshops.eu plus klassische Snack-/Getränkeautomaten
export const VENDING_REGEX =
  "milk|egg|food|cheese|sausage|meat|potato|noodle|tomato|honey|fruit|bread|" +
  "drinks|sweets|pizza|ice_cream|coffee|farm";

export const VENDING_LABELS = {
  milk: "Milchtankstelle", egg: "Eierautomat", eggs: "Eierautomat",
  food: "Lebensmittelautomat", cheese: "Käseautomat", sausage: "Wurstautomat",
  meat: "Fleischautomat", potato: "Kartoffelautomat", noodle: "Nudelautomat",
  tomato: "Gemüseautomat", honey: "Honigautomat", fruit: "Obstautomat",
  bread: "Brotautomat", drinks: "Getränkeautomat", sweets: "Snackautomat",
  pizza: "Pizzaautomat", ice_cream: "Eisautomat", coffee: "Kaffeeautomat",
  farm: "Hofautomat",
};

const POI_SELECTORS = [
  `nwr["tourism"~"museum|gallery|attraction|theme_park|zoo|viewpoint"]`,
  `nwr["leisure"~"water_park|sports_centre|stadium"]`,
  `nwr["amenity"~"theatre|cinema"]`,
  `nwr["shop"="mall"]`,
  `nwr["shop"="farm"]`,
  `nwr["amenity"="marketplace"]`,
  `nwr["craft"="beekeeper"]`,
];

const MACHINE_SELECTOR =
  `nwr["amenity"="vending_machine"]["vending"~"${VENDING_REGEX}"]["vending"!~"animal_food"]`;

const PLACE_SELECTOR = `node["place"~"city|town|village"]["population"]`;

/** Viewport-Abfrage: POIs + Automaten + Bevölkerung in einer Bounding-Box. */
export function buildBboxQuery(bbox) {
  const b = `${bbox.s},${bbox.w},${bbox.n},${bbox.e}`;
  return `[out:json][timeout:60][bbox:${b}];
(
  ${POI_SELECTORS.join(";\n  ")};
  ${MACHINE_SELECTOR};
  ${PLACE_SELECTOR};
);
out center tags;`;
}

/** Deutschland-Komplettabfrage des farmshops-Datenmodells (Server, nächtlich). */
export function buildGermanyFarmshopsQuery() {
  return `[out:json][timeout:900][maxsize:1073741824];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(
  ${MACHINE_SELECTOR}(area.de);
  nwr["shop"="farm"](area.de);
  nwr["amenity"="marketplace"](area.de);
  nwr["craft"="beekeeper"](area.de);
);
out center tags;`;
}

/** Deutschland-Bevölkerung: alle place-Nodes mit population-Tag (Server, nächtlich). */
export function buildGermanyPopulationQuery() {
  return `[out:json][timeout:600];
area["ISO3166-1"="DE"][admin_level=2]->.de;
${PLACE_SELECTOR}(area.de);
out;`;
}

export function classify(tags) {
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

export function vendingLabel(vending) {
  const first = String(vending || "").split(";")[0].trim();
  return VENDING_LABELS[first] || "Verkaufsautomat";
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Overpass-Elemente in App-Datensätze überführen.
 * @returns {{pois:[], machines:[], population:[]}}
 */
export function parseElements(elements) {
  const pois = [], machines = [], population = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const el of elements || []) {
    const tags = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null) continue;

    if (tags.place) {
      const pop = parseInt(String(tags.population).replace(/[^\d]/g, ""), 10);
      if (!tags.name || !pop) continue;
      population.push({ name: tags.name, lat, lng, pop });
      continue;
    }

    if (tags.amenity === "vending_machine") {
      const label = vendingLabel(tags.vending);
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
        installedAt: today,
      });
      continue;
    }

    if (!tags.name) continue;
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
      updated: today,
    });
  }
  return { pois, machines, population };
}

/** Bbox-Filter für Server-Endpunkte. */
export function inBbox(item, bbox) {
  return item.lat >= bbox.s && item.lat <= bbox.n &&
         item.lng >= bbox.w && item.lng <= bbox.e;
}

export function parseBboxParam(str) {
  const [s, w, n, e] = String(str || "").split(",").map(Number);
  if ([s, w, n, e].some((x) => !isFinite(x)) || s >= n || w >= e) return null;
  return { s, w, n, e };
}
