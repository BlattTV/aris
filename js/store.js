/**
 * Zentraler Anwendungs-Store mit localStorage-Persistenz,
 * Event-System und Import/Export.
 */
import { SEED_ATTRACTIONS, POPULATION_CENTERS, DEFAULT_SETTINGS } from "./data.js";
import { haversineKm } from "./queries.mjs";

const LS_KEY = "coburg-analyzer-v1";

const listeners = new Set();

export const state = {
  attractions: [],        // Seed + Overpass + manuell
  machines: [],           // {id, name, lat, lng, type, monthlySalesEur?, owner, installedAt, isCompetitor}
  settings: { ...DEFAULT_SETTINGS },
  selection: null,        // {lat, lng} aktueller Analysepunkt
  lastRefresh: null,      // ISO-Zeitstempel der letzten Datenaktualisierung
  overpassPois: [],       // automatisch geladene POIs (in-memory, je Viewport)
  osmMachines: [],        // automatisch geladene Automaten (farmshops.eu-Datenmodell)
  populationCenters: [],  // Bevölkerungsschwerpunkte (Seed + OSM-place-Nodes)
  hiddenOsmIds: [],       // vom Nutzer ausgeblendete OSM-Automaten
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(topic) {
  listeners.forEach((fn) => fn(topic));
}

export function load() {
  state.attractions = SEED_ATTRACTIONS.map((a) => ({ ...a, source: "kuratiert" }));
  state.populationCenters = POPULATION_CENTERS.map((p) => ({ ...p, source: "kuratiert" }));
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.machines = saved.machines || [];
      state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      state.lastRefresh = saved.lastRefresh || null;
      state.hiddenOsmIds = saved.hiddenOsmIds || [];
      if (saved.customAttractions) {
        state.attractions.push(
          ...saved.customAttractions.map((a) => ({ ...a, source: "manuell" }))
        );
      }
    }
  } catch (e) {
    console.warn("Persistenz konnte nicht geladen werden:", e);
  }
}

export function persist() {
  // Massendaten (POIs, OSM-Automaten, Bevölkerung) werden bewusst nicht
  // persistiert – sie kommen je Kartenausschnitt frisch vom Server/Overpass.
  const data = {
    machines: state.machines,
    settings: state.settings,
    lastRefresh: state.lastRefresh,
    hiddenOsmIds: state.hiddenOsmIds,
    customAttractions: state.attractions.filter((a) => a.source === "manuell"),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// Obergrenzen gegen Speicherwachstum bei langen Sitzungen quer durch Deutschland
const MAX_POIS = 8000;
const MAX_OSM_MACHINES = 8000;
const MAX_POPULATION = 6000;

/**
 * Viewport-Daten deduplizierend in den Store übernehmen
 * (gemeinsamer Pfad für Server-API und direkten Overpass-Abruf).
 */
export function mergeFetched({ pois = [], machines = [], population = [] }) {
  const knownNames = new Set(
    state.attractions.map((a) => a.name.toLowerCase().slice(0, 12))
  );
  const poiIds = new Set(state.overpassPois.map((p) => p.id));
  for (const p of pois) {
    if (poiIds.has(p.id)) continue;
    if (knownNames.has(p.name.toLowerCase().slice(0, 12))) continue;
    state.overpassPois.push(p);
  }
  if (state.overpassPois.length > MAX_POIS)
    state.overpassPois = state.overpassPois.slice(-MAX_POIS);

  const machineIds = new Set(state.osmMachines.map((m) => m.id));
  for (const m of machines) {
    if (machineIds.has(m.id)) continue;
    // Dublette: manuell erfasster Automat in < 50 m Entfernung
    if (state.machines.some((x) => haversineKm(m.lat, m.lng, x.lat, x.lng) < 0.05)) continue;
    state.osmMachines.push(m);
  }
  if (state.osmMachines.length > MAX_OSM_MACHINES)
    state.osmMachines = state.osmMachines.slice(-MAX_OSM_MACHINES);

  for (const p of population) {
    if (!state.populationCenters.some(
      (x) => haversineKm(p.lat, p.lng, x.lat, x.lng) < 1.0
    )) state.populationCenters.push(p);
  }
  if (state.populationCenters.length > MAX_POPULATION)
    state.populationCenters = state.populationCenters.slice(-MAX_POPULATION);

  notify("data:merged");
}

export function allAttractions() {
  return [...state.attractions, ...state.overpassPois];
}

/**
 * Alle für die Wettbewerbs-Berechnung relevanten Automaten:
 * manuell erfasste plus (sofern aktiviert) automatisch aus
 * OpenStreetMap/farmshops übernommene, ohne ausgeblendete.
 */
export function allMachines() {
  const list = [...state.machines];
  if (state.settings.includeOsmMachines) {
    list.push(...state.osmMachines.filter((m) => !state.hiddenOsmIds.includes(m.id)));
  }
  return list;
}

// --- Automaten ---

export function addMachine(machine) {
  const m = {
    id: "m-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: machine.name || "Automat",
    type: machine.type || "Snack",
    lat: machine.lat,
    lng: machine.lng,
    isCompetitor: !!machine.isCompetitor,
    monthlySalesEur: machine.monthlySalesEur || null,
    note: machine.note || "",
    installedAt: machine.installedAt || new Date().toISOString().slice(0, 10),
  };
  state.machines.push(m);
  persist();
  notify("machines");
  return m;
}

export function updateMachine(id, patch) {
  const m = state.machines.find((x) => x.id === id);
  if (m) {
    Object.assign(m, patch);
    persist();
    notify("machines");
  }
}

export function removeMachine(id) {
  if (id.startsWith("osm-")) {
    // Automatisch geladene Automaten nicht löschen, sondern ausblenden,
    // sonst kämen sie bei der nächsten Aktualisierung zurück.
    if (!state.hiddenOsmIds.includes(id)) state.hiddenOsmIds.push(id);
  } else {
    state.machines = state.machines.filter((x) => x.id !== id);
  }
  persist();
  notify("machines");
}

export function restoreHiddenOsmMachines() {
  state.hiddenOsmIds = [];
  persist();
  notify("machines");
}

// --- Attraktionen (manuell) ---

export function addAttraction(a) {
  const item = {
    id: "a-" + Date.now().toString(36),
    name: a.name,
    cat: a.cat || "freizeit",
    lat: a.lat,
    lng: a.lng,
    visitors: Number(a.visitors) || 10000,
    dwellMin: Number(a.dwellMin) || 60,
    note: a.note || "",
    updated: new Date().toISOString().slice(0, 7),
    source: "manuell",
  };
  state.attractions.push(item);
  persist();
  notify("attractions");
  return item;
}

export function removeAttraction(id) {
  state.attractions = state.attractions.filter(
    (a) => !(a.id === id && a.source === "manuell")
  );
  persist();
  notify("attractions");
}

// --- Einstellungen ---

export function updateSettings(patch) {
  Object.assign(state.settings, patch);
  persist();
  notify("settings");
}

// --- Import / Export ---

export function exportJson() {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      machines: state.machines,
      settings: state.settings,
      hiddenOsmIds: state.hiddenOsmIds,
      customAttractions: state.attractions.filter((a) => a.source === "manuell"),
    },
    null,
    2
  );
}

export function importJson(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data.machines)) state.machines = data.machines;
  if (data.settings) state.settings = { ...DEFAULT_SETTINGS, ...data.settings };
  if (Array.isArray(data.hiddenOsmIds)) state.hiddenOsmIds = data.hiddenOsmIds;
  if (Array.isArray(data.customAttractions)) {
    state.attractions = state.attractions.filter((a) => a.source !== "manuell");
    state.attractions.push(...data.customAttractions.map((a) => ({ ...a, source: "manuell" })));
  }
  persist();
  notify("import");
}
