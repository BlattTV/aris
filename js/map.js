/**
 * Leaflet-Karte: Attraktions-Marker, Automaten, Analyse-Radius,
 * Potenzial-Heatmap und Standortvorschläge.
 */
import { CATEGORIES } from "./data.js";
import { state, allAttractions, allMachines, subscribe, notify } from "./store.js";
import { analyzePoint, scoreGrid, suggestLocations, fmtNum } from "./analysis.js";
import { loadViewport } from "./api.js";

export let map;
let attractionLayer, machineLayer, analysisLayer, heatLayer, suggestionLayer, popLayer,
  eventLayer, teamLayer, routeLayer;
let clickMode = "analyze"; // analyze | addMachine | addAttraction
let onMapPick = null;

export function setClickMode(mode, cb) {
  clickMode = mode;
  onMapPick = cb || null;
  document.getElementById("map").style.cursor =
    mode === "analyze" ? "" : "crosshair";
}

export function initMap() {
  // Canvas-Renderer: nötig für tausende Marker bei Deutschland-Abdeckung
  map = L.map("map", { zoomControl: false, preferCanvas: true })
    .setView([50.2585, 10.9645], 12);
  L.control.zoom({ position: "bottomright" }).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  attractionLayer = L.layerGroup().addTo(map);
  machineLayer = L.layerGroup().addTo(map);
  analysisLayer = L.layerGroup().addTo(map);
  heatLayer = L.layerGroup();
  suggestionLayer = L.layerGroup().addTo(map);
  popLayer = L.layerGroup();
  eventLayer = L.layerGroup().addTo(map);
  teamLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);

  L.control
    .layers(null, {
      "Attraktionen": attractionLayer,
      "Automaten": machineLayer,
      "Events": eventLayer,
      "Team": teamLayer,
      "Tour": routeLayer,
      "Potenzial-Raster": heatLayer,
      "Bevölkerung": popLayer,
      "Standort-Vorschläge": suggestionLayer,
    }, { position: "bottomleft" })
    .addTo(map);

  map.on("click", (e) => {
    if (clickMode === "analyze") {
      state.selection = { lat: e.latlng.lat, lng: e.latlng.lng };
      notify("selection");
    } else if (onMapPick) {
      const cb = onMapPick;
      setClickMode("analyze");
      cb(e.latlng);
    }
  });

  renderAttractions();
  renderMachines();
  renderPopulation();
  renderEvents();
  renderTeam();

  subscribe((topic) => {
    if (["attractions", "data:merged", "import"].includes(topic)) renderAttractions();
    if (["machines", "import", "data:merged", "settings"].includes(topic)) {
      renderMachines();
      if (state.selection) renderAnalysis();
    }
    if (topic === "data:merged") renderPopulation();
    if (["events", "import"].includes(topic)) {
      renderEvents();
      if (state.selection) renderAnalysis();
    }
    if (topic === "team") renderTeam();
    if (topic === "selection" || topic === "settings") renderAnalysis();
  });

  // Deutschlandweit: Daten je Kartenausschnitt nachladen (entprellt)
  let moveTimer = null;
  map.on("moveend", () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => loadViewport(map.getBounds()), 400);
  });
  loadViewport(map.getBounds());
}

function markerRadius(visitors) {
  return Math.max(6, Math.min(26, Math.log10(Math.max(visitors, 100)) * 4 - 8));
}

export function renderAttractions() {
  attractionLayer.clearLayers();
  for (const a of allAttractions()) {
    const cat = CATEGORIES[a.cat] || CATEGORIES.freizeit;
    const marker = L.circleMarker([a.lat, a.lng], {
      radius: markerRadius(a.visitors),
      color: cat.color,
      weight: 2,
      fillColor: cat.color,
      fillOpacity: a.source === "osm" ? 0.25 : 0.55,
    }).addTo(attractionLayer);
    marker.bindPopup(`
      <strong>${cat.icon} ${a.name}</strong><br>
      ${cat.label}${a.source === "osm" ? " · <em>OSM (auto)</em>" : ""}<br>
      Besucher/Jahr: <strong>${fmtNum(a.visitors)}</strong><br>
      ${a.note ? a.note + "<br>" : ""}
      <button class="popup-btn" data-analyze="${a.lat},${a.lng}">📍 Hier analysieren</button>
    `);
  }
}

export function renderMachines() {
  machineLayer.clearLayers();
  for (const m of allMachines()) {
    const fromOsm = m.source === "osm";
    const icon = L.divIcon({
      className: "machine-icon",
      html: `<div class="machine-pin ${m.isCompetitor ? "competitor" : "own"}${fromOsm ? " osm" : ""}">${fromOsm ? "🧺" : "🥤"}</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    L.marker([m.lat, m.lng], { icon })
      .bindPopup(`
        <strong>${fromOsm ? "🧺" : "🥤"} ${m.name}</strong><br>
        Typ: ${m.type} · ${m.isCompetitor ? "Wettbewerber" : "Eigener Automat"}<br>
        ${fromOsm ? "Quelle: OpenStreetMap (farmshops-Daten, auto-aktualisiert)<br>" : ""}
        ${m.monthlySalesEur ? `Umsatz: ${fmtNum(m.monthlySalesEur)} €/Monat<br>` : ""}
        ${m.note ? m.note + "<br>" : ""}
        <button class="popup-btn" data-analyze="${m.lat},${m.lng}">📍 Standort analysieren</button>
      `)
      .addTo(machineLayer);
  }
}

function renderPopulation() {
  popLayer.clearLayers();
  for (const p of state.populationCenters) {
    L.circle([p.lat, p.lng], {
      radius: Math.sqrt(p.pop) * 18,
      color: "#64748b",
      weight: 1,
      fillColor: "#64748b",
      fillOpacity: 0.12,
    })
      .bindTooltip(`${p.name}: ${fmtNum(p.pop)} Einwohner`)
      .addTo(popLayer);
  }
}

export function renderEvents() {
  eventLayer.clearLayers();
  const today = new Date().toISOString().slice(0, 10);
  for (const ev of state.events) {
    const active = today >= ev.from && today <= ev.to;
    const icon = L.divIcon({
      className: "event-icon",
      html: `<div class="event-pin${active ? " active" : ""}">📅</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    L.marker([ev.lat, ev.lng], { icon })
      .bindPopup(`
        <strong>📅 ${ev.name}</strong><br>
        ${ev.from} bis ${ev.to} ${active ? "· <strong>läuft gerade</strong>" : ""}<br>
        Erwartete Besucher: ${fmtNum(ev.visitors)}<br>
        <button class="popup-btn" data-analyze="${ev.lat},${ev.lng}">📍 Hier analysieren</button>
      `)
      .addTo(eventLayer);
  }
}

export function renderTeam() {
  teamLayer.clearLayers();
  for (const m of state.teamMachines) {
    const icon = L.divIcon({
      className: "machine-icon",
      html: `<div class="machine-pin team">👥</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
    L.marker([m.lat, m.lng], { icon })
      .bindPopup(`
        <strong>👥 ${m.name}</strong><br>
        Team-Standort von ${m.owner}<br>
        <button class="popup-btn" data-analyze="${m.lat},${m.lng}">📍 Standort analysieren</button>
      `)
      .addTo(teamLayer);
  }
}

/** Geplante Befüllungstour einzeichnen. */
export function renderRoute(route) {
  routeLayer.clearLayers();
  if (!route) return;
  const latlngs = [...route.order.map((p) => [p.lat, p.lng]), [route.order[0].lat, route.order[0].lng]];
  L.polyline(latlngs, { color: "#f59e0b", weight: 3, dashArray: "8 6" }).addTo(routeLayer);
  route.order.forEach((p, i) => {
    if (p.isStart) return;
    const icon = L.divIcon({
      className: "route-icon",
      html: `<div class="route-stop">${i}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    L.marker([p.lat, p.lng], { icon }).bindTooltip(`Stopp ${i}: ${p.name}`).addTo(routeLayer);
  });
  const start = route.order[0];
  L.marker([start.lat, start.lng], {
    icon: L.divIcon({ className: "route-icon", html: `<div class="route-stop start">🏁</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
  }).bindTooltip("Start/Depot").addTo(routeLayer);
}

export function renderAnalysis() {
  analysisLayer.clearLayers();
  if (!state.selection) return;
  const { lat, lng } = state.selection;
  const r = analyzePoint(lat, lng);

  L.circle([lat, lng], {
    radius: r.radiusKm * 1000,
    color: "#22d3ee",
    weight: 2,
    dashArray: "6 6",
    fillColor: "#22d3ee",
    fillOpacity: 0.07,
  }).addTo(analysisLayer);

  const icon = L.divIcon({
    className: "analysis-icon",
    html: `<div class="analysis-pin">📍<span class="score-badge s${scoreClass(r.score)}">${r.score}</span></div>`,
    iconSize: [34, 40],
    iconAnchor: [17, 38],
  });
  L.marker([lat, lng], { icon }).addTo(analysisLayer);
}

function scoreClass(score) {
  return score >= 70 ? 3 : score >= 40 ? 2 : 1;
}

export function renderHeatmap() {
  heatLayer.clearLayers();
  const b = map.getBounds();
  const grid = scoreGrid({
    south: b.getSouth(), north: b.getNorth(),
    west: b.getWest(), east: b.getEast(),
  }, Math.max(0.6, (b.getNorth() - b.getSouth()) * 111 / 24));
  for (const g of grid) {
    const color = g.score >= 70 ? "#22c55e" : g.score >= 40 ? "#eab308" : "#ef4444";
    L.circle([g.lat, g.lng], {
      radius: 280,
      color, weight: 0,
      fillColor: color,
      fillOpacity: 0.10 + (g.score / 100) * 0.35,
    })
      .bindTooltip(`Score ${g.score} · ~${fmtNum(g.customersDay, 1)} Kunden/Tag`)
      .addTo(heatLayer);
  }
  if (!map.hasLayer(heatLayer)) map.addLayer(heatLayer);
}

export function renderSuggestions() {
  suggestionLayer.clearLayers();
  const b = map.getBounds();
  const spots = suggestLocations({
    south: b.getSouth(), north: b.getNorth(),
    west: b.getWest(), east: b.getEast(),
  });
  spots.forEach((s, i) => {
    const icon = L.divIcon({
      className: "suggestion-icon",
      html: `<div class="suggestion-pin">⭐<span>${i + 1}</span></div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    L.marker([s.lat, s.lng], { icon })
      .bindPopup(`
        <strong>⭐ Standort-Vorschlag #${i + 1}</strong><br>
        Score: <strong>${s.score}/100</strong> · ~${fmtNum(s.customersDay, 1)} Kunden/Tag<br>
        <button class="popup-btn" data-analyze="${s.lat},${s.lng}">📍 Detail-Analyse</button>
      `)
      .addTo(suggestionLayer);
  });
  return spots.length;
}

// Popup-Buttons (event delegation, da Popups dynamisch entstehen)
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-analyze]");
  if (btn) {
    const [lat, lng] = btn.dataset.analyze.split(",").map(Number);
    state.selection = { lat, lng };
    notify("selection");
    map.closePopup();
  }
});
