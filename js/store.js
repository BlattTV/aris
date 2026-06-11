/**
 * Zentraler Anwendungs-Store mit localStorage-Persistenz,
 * Event-System und Import/Export.
 */
import { SEED_ATTRACTIONS, DEFAULT_SETTINGS } from "./data.js";

const LS_KEY = "coburg-analyzer-v1";

const listeners = new Set();

export const state = {
  attractions: [],        // Seed + Overpass + manuell
  machines: [],           // {id, name, lat, lng, type, monthlySalesEur?, owner, installedAt, isCompetitor}
  settings: { ...DEFAULT_SETTINGS },
  selection: null,        // {lat, lng} aktueller Analysepunkt
  lastRefresh: null,      // ISO-Zeitstempel der letzten Overpass-Aktualisierung
  overpassPois: [],       // automatisch geladene POIs
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
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      state.machines = saved.machines || [];
      state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
      state.lastRefresh = saved.lastRefresh || null;
      state.overpassPois = saved.overpassPois || [];
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
  const data = {
    machines: state.machines,
    settings: state.settings,
    lastRefresh: state.lastRefresh,
    overpassPois: state.overpassPois,
    customAttractions: state.attractions.filter((a) => a.source === "manuell"),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

export function allAttractions() {
  return [...state.attractions, ...state.overpassPois];
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
  state.machines = state.machines.filter((x) => x.id !== id);
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
  if (Array.isArray(data.customAttractions)) {
    state.attractions = state.attractions.filter((a) => a.source !== "manuell");
    state.attractions.push(...data.customAttractions.map((a) => ({ ...a, source: "manuell" })));
  }
  persist();
  notify("import");
}
