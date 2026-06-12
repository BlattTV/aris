/**
 * UI: Sidebar-Panels (Analyse, Attraktionen, Automaten, Dashboard,
 * Einstellungen), Rendering der Kennzahlen, Export & Berichte.
 */
import { CATEGORIES, SEASONALITY } from "./data.js";
import {
  state, allAttractions, allMachines, subscribe, notify,
  addMachine, updateMachine, removeMachine, restoreHiddenOsmMachines,
  addAttraction, removeAttraction,
  updateSettings, exportJson, importJson,
} from "./store.js";
import { analyzePoint, haversineKm, fmtNum, fmtEur } from "./analysis.js";
import { setClickMode, renderHeatmap, renderSuggestions, map } from "./map.js";
import { refreshNow, scheduleAutoRefresh, getMode, getServerStatus, geocode, loadViewport } from "./api.js";
import { getUserInfo, logout, redeemLicense, changePassword, showAuthOverlay } from "./auth.js";
import { barChart, donut } from "./charts.js";

const $ = (sel) => document.querySelector(sel);

export function initUi() {
  initTabs();
  renderAnalysisPanel();
  renderAttractionsPanel();
  renderMachinesPanel();
  renderDashboard();
  renderSettingsPanel();
  bindGlobalActions();

  subscribe((topic) => {
    if (topic === "selection" || topic === "settings" || topic === "machines")
      renderAnalysisPanel();
    if (["attractions", "data:merged", "import"].includes(topic))
      renderAttractionsPanel();
    if (["machines", "import", "data:merged"].includes(topic)) renderMachinesPanel();
    if (["machines", "settings", "data:merged", "import", "selection"].includes(topic))
      renderDashboard();
    if (topic === "data:loading") setDataStatus("⏳ lädt…");
    if (topic === "data:merged") {
      setDataStatus("");
      renderSettingsPanel();
    }
    if (topic === "data:toolarge") setDataStatus("🔍 zum Laden hineinzoomen");
    if (topic === "data:error") setDataStatus("⚠️ Datenabruf fehlgeschlagen");
    if (topic === "mode") renderSettingsPanel();
    if (topic === "auth") renderSettingsPanel();
    if (topic === "auth:required") {
      setDataStatus("🔒 Anmeldung erforderlich");
      showAuthOverlay();
    }
  });
}

function setDataStatus(text) {
  const el = $("#data-status");
  if (el) el.textContent = text;
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#panel-" + btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "dashboard") renderDashboard();
    });
  });
}

function setRefreshStatus(text) {
  const el = $("#refresh-status");
  if (el) el.textContent = text;
}

// ---------- Panel: Analyse ----------

function renderAnalysisPanel() {
  const el = $("#analysis-result");
  const slider = $("#radius-slider");
  slider.value = state.settings.radiusKm;
  $("#radius-value").textContent = state.settings.radiusKm.toFixed(1) + " km";

  if (!state.selection) {
    el.innerHTML = `<div class="hint">👆 Klicke auf die Karte, um einen Standort zu analysieren – oder nutze „Beste Standorte finden".</div>`;
    return;
  }

  const r = analyzePoint(state.selection.lat, state.selection.lng);
  const scoreCls = r.score >= 70 ? "good" : r.score >= 40 ? "mid" : "bad";

  el.innerHTML = `
    <div class="score-card ${scoreCls}">
      <div class="score-num">${r.score}</div>
      <div class="score-label">Standort-Score<br><small>${r.point.lat.toFixed(4)}, ${r.point.lng.toFixed(4)}</small></div>
    </div>
    <div class="kpi-grid">
      <div class="kpi"><span>${fmtNum(r.customersDay, 1)}</span>Kunden / Tag</div>
      <div class="kpi"><span>${fmtNum(r.customersYear)}</span>Kunden / Jahr</div>
      <div class="kpi"><span>${fmtEur(r.revenueYear)}</span>Umsatz / Jahr</div>
      <div class="kpi ${r.breakEven ? "pos" : "neg"}"><span>${fmtEur(r.netProfitYear)}</span>Gewinn / Jahr*</div>
      <div class="kpi"><span>${fmtNum(r.visitorPotentialYear)}</span>Besucherpotenzial</div>
      <div class="kpi"><span>${fmtNum(r.residentsInRange)}</span>Einwohner im Radius</div>
    </div>
    <div class="sub">* nach Marge (${state.settings.marginPct} %) und Betriebskosten (${fmtEur(r.opexYear)}/Jahr)</div>

    ${r.competitors.length ? `
      <h4>⚠️ ${r.competitors.length} Automat(en) im Radius – Marktanteil ${(r.marketShare * 100).toFixed(0)} %</h4>
      <ul class="mini-list">
        ${r.competitors.map((c) => `<li>🥤 ${c.name} <small>(${fmtNum(c.distanceKm * 1000)} m, ${c.isCompetitor ? "Wettbewerber" : "eigener"})</small></li>`).join("")}
      </ul>` : `<div class="sub ok">✅ Keine konkurrierenden Automaten im Radius</div>`}

    <h4>Potenzialtreiber im Radius (${r.contributions.length})</h4>
    <ul class="mini-list">
      ${r.contributions.slice(0, 8).map((c) => {
        const cat = CATEGORIES[c.attraction.cat] || CATEGORIES.freizeit;
        return `<li>${cat.icon} ${c.attraction.name}
          <small>${fmtNum(c.distanceKm * 1000)} m · wirksam ${fmtNum(c.effectiveVisitors)} Bes./Jahr</small></li>`;
      }).join("")}
      ${r.contributions.length === 0 ? "<li><small>Keine Attraktion im Radius – Potenzial nur aus Wohnbevölkerung.</small></li>" : ""}
    </ul>
    <div class="btn-row">
      <button class="btn" id="btn-place-here">🥤 Automat hier platzieren</button>
      <button class="btn ghost" id="btn-copy-report">📋 Bericht kopieren</button>
    </div>
  `;

  $("#btn-place-here").addEventListener("click", () => {
    const name = prompt("Name des Automaten:", "Mein Automat " + (state.machines.length + 1));
    if (name) addMachine({ name, lat: r.point.lat, lng: r.point.lng, isCompetitor: false });
  });
  $("#btn-copy-report").addEventListener("click", () => {
    navigator.clipboard.writeText(textReport(r)).then(
      () => alert("Bericht in Zwischenablage kopiert."),
      () => alert(textReport(r))
    );
  });
}

function textReport(r) {
  return [
    `STANDORT-ANALYSE ${new Date().toLocaleDateString("de-DE")}`,
    `Position: ${r.point.lat.toFixed(5)}, ${r.point.lng.toFixed(5)} | Radius: ${r.radiusKm} km`,
    `Score: ${r.score}/100`,
    `Kunden: ${fmtNum(r.customersDay, 1)}/Tag (${fmtNum(r.customersYear)}/Jahr)`,
    `Umsatz: ${fmtEur(r.revenueYear)}/Jahr | Gewinn: ${fmtEur(r.netProfitYear)}/Jahr`,
    `Besucherpotenzial: ${fmtNum(r.visitorPotentialYear)} | Einwohner: ${fmtNum(r.residentsInRange)}`,
    `Wettbewerber im Radius: ${r.competitors.length} (Marktanteil ${(r.marketShare * 100).toFixed(0)} %)`,
  ].join("\n");
}

// ---------- Panel: Attraktionen ----------

function renderAttractionsPanel() {
  const list = allAttractions().slice().sort((a, b) => b.visitors - a.visitors);
  $("#attractions-list").innerHTML = list.map((a) => {
    const cat = CATEGORIES[a.cat] || CATEGORIES.freizeit;
    return `<li class="card" data-goto="${a.lat},${a.lng}">
      <div class="card-head">
        <span class="cat-dot" style="background:${cat.color}"></span>
        <strong>${cat.icon} ${a.name}</strong>
        ${a.source === "manuell" ? `<button class="del" data-del-attr="${a.id}" title="Löschen">✕</button>` : ""}
      </div>
      <small>${cat.label} · ${fmtNum(a.visitors)} Besucher/Jahr · Quelle: ${a.source}</small>
    </li>`;
  }).join("");
  $("#attractions-count").textContent = list.length;

  $("#attractions-list").querySelectorAll("[data-del-attr]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm("Attraktion löschen?")) removeAttraction(b.dataset.delAttr);
    })
  );
  $("#attractions-list").querySelectorAll("[data-goto]").forEach((li) =>
    li.addEventListener("click", () => {
      const [lat, lng] = li.dataset.goto.split(",").map(Number);
      map.setView([lat, lng], 14);
    })
  );
}

// ---------- Panel: Automaten ----------

function renderMachinesPanel() {
  const machines = allMachines();
  const own = machines.filter((m) => !m.isCompetitor);
  const comp = machines.filter((m) => m.isCompetitor && m.source !== "osm");
  const osm = machines.filter((m) => m.source === "osm");
  $("#machines-count").textContent =
    `${own.length} eigene · ${comp.length} Wettbewerber (manuell) · ${osm.length} aus OpenStreetMap/farmshops geladen`;

  // Eigene/manuelle zuerst; automatisch geladene nur aus dem aktuellen
  // Kartenausschnitt und gedeckelt – deutschlandweit wären es tausende.
  const center = map.getCenter();
  const bounds = map.getBounds();
  const osmVisible = osm
    .filter((m) => bounds.contains([m.lat, m.lng]))
    .sort((a, b) =>
      haversineKm(center.lat, center.lng, a.lat, a.lng) -
      haversineKm(center.lat, center.lng, b.lat, b.lng))
    .slice(0, 50);
  const sorted = [...state.machines, ...osmVisible];

  $("#machines-list").innerHTML = sorted.map((m) => {
    const fromOsm = m.source === "osm";
    const r = analyzePoint(m.lat, m.lng);
    return `<li class="card" data-goto="${m.lat},${m.lng}">
      <div class="card-head">
        <strong>${fromOsm ? "🧺" : "🥤"} ${m.name}</strong>
        ${fromOsm ? `<span class="badge">OSM</span>` : ""}
        <span class="badge ${m.isCompetitor ? "warn" : "ok"}">${m.isCompetitor ? "Wettbewerb" : "Eigen"}</span>
        <button class="del" data-del-machine="${m.id}" title="${fromOsm ? "Aus Berechnung ausblenden" : "Löschen"}">✕</button>
      </div>
      <small>${m.type}${fromOsm ? (m.operator ? " · " + m.operator : "") : " · seit " + m.installedAt} · Score ${r.score}/100${fromOsm ? "" : " · Prognose " + fmtEur(r.revenueYear) + "/Jahr"}</small>
      ${m.monthlySalesEur ? `<small>Ist-Umsatz: ${fmtNum(m.monthlySalesEur)} €/Monat ${istVsPlan(m, r)}</small>` : ""}
      ${fromOsm ? "" : `<div class="btn-row">
        <button class="btn tiny ghost" data-edit-machine="${m.id}">✏️ Ist-Umsatz erfassen</button>
      </div>`}
    </li>`;
  }).join("") || `<li class="hint">Noch keine Automaten erfasst. Nutze „+ Automat auf Karte setzen" oder „🔄 Jetzt aktualisieren" in den Einstellungen, um Automaten aus OpenStreetMap/farmshops zu laden.</li>`;

  $("#machines-list").querySelectorAll("[data-del-machine]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = b.dataset.delMachine;
      const msg = id.startsWith("osm-")
        ? "Diesen OSM-Automaten aus der Berechnung ausblenden?"
        : "Automat löschen?";
      if (confirm(msg)) removeMachine(id);
    })
  );
  $("#machines-list").querySelectorAll("[data-edit-machine]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = state.machines.find((x) => x.id === b.dataset.editMachine);
      const v = prompt(`Ist-Umsatz für „${m.name}" (€/Monat):`, m.monthlySalesEur || "");
      if (v !== null) updateMachine(m.id, { monthlySalesEur: Number(v) || null });
    })
  );
  $("#machines-list").querySelectorAll("[data-goto]").forEach((li) =>
    li.addEventListener("click", () => {
      const [lat, lng] = li.dataset.goto.split(",").map(Number);
      map.setView([lat, lng], 15);
    })
  );
}

function istVsPlan(m, r) {
  const planMonth = r.revenueYear / 12;
  if (!planMonth) return "";
  const ratio = (m.monthlySalesEur / planMonth) * 100;
  const cls = ratio >= 90 ? "ok" : ratio >= 60 ? "warn" : "bad";
  return `<span class="badge ${cls}">${ratio.toFixed(0)} % vom Plan</span>`;
}

// ---------- Panel: Dashboard ----------

function renderDashboard() {
  const own = state.machines.filter((m) => !m.isCompetitor);
  let totalRevenue = 0, totalProfit = 0, totalCustomers = 0, actualMonthly = 0;
  for (const m of own) {
    const r = analyzePoint(m.lat, m.lng);
    totalRevenue += r.revenueYear;
    totalProfit += r.netProfitYear;
    totalCustomers += r.customersYear;
    actualMonthly += m.monthlySalesEur || 0;
  }

  $("#dash-kpis").innerHTML = `
    <div class="kpi big"><span>${own.length}</span>Eigene Automaten</div>
    <div class="kpi big"><span>${fmtEur(totalRevenue)}</span>Plan-Umsatz / Jahr</div>
    <div class="kpi big ${totalProfit >= 0 ? "pos" : "neg"}"><span>${fmtEur(totalProfit)}</span>Plan-Gewinn / Jahr</div>
    <div class="kpi big"><span>${fmtNum(totalCustomers)}</span>Kunden / Jahr</div>
    <div class="kpi big"><span>${actualMonthly ? fmtEur(actualMonthly * 12) : "–"}</span>Ist-Umsatz / Jahr</div>
    <div class="kpi big"><span>${fmtNum(allAttractions().reduce((s, a) => s + a.visitors, 0))}</span>Besucher Region / Jahr</div>
  `;

  // Saisonalität: gewichteter Verlauf über alle Attraktionen
  const monthLabels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const monthly = monthLabels.map((_, i) =>
    allAttractions().reduce((s, a) => {
      const row = SEASONALITY[a.cat] || SEASONALITY.freizeit;
      return s + (a.visitors / 12) * row[i];
    }, 0)
  );
  const c1 = $("#chart-season");
  if (c1.clientWidth) barChart(c1, monthLabels, monthly, {
    color: "#22d3ee",
    format: (v) => fmtNum(v / 1000) + "k",
  });

  // Kategorie-Verteilung
  const byCat = {};
  for (const a of allAttractions()) byCat[a.cat] = (byCat[a.cat] || 0) + a.visitors;
  const segs = Object.entries(byCat)
    .sort((x, y) => y[1] - x[1])
    .map(([cat, v]) => ({
      value: v,
      color: (CATEGORIES[cat] || CATEGORIES.freizeit).color,
      label: (CATEGORIES[cat] || CATEGORIES.freizeit).label,
    }));
  const c2 = $("#chart-cats");
  if (c2.clientWidth) donut(c2, segs);

  // Ranking eigener Standorte
  const ranked = own
    .map((m) => ({ m, r: analyzePoint(m.lat, m.lng) }))
    .sort((a, b) => b.r.netProfitYear - a.r.netProfitYear);
  $("#dash-ranking").innerHTML = ranked.map(({ m, r }, i) => `
    <li class="card">
      <div class="card-head"><strong>#${i + 1} ${m.name}</strong>
        <span class="badge ${r.breakEven ? "ok" : "bad"}">${r.breakEven ? "rentabel" : "unrentabel"}</span></div>
      <small>Score ${r.score} · ${fmtNum(r.customersDay, 1)} Kunden/Tag · Gewinn ${fmtEur(r.netProfitYear)}/Jahr</small>
    </li>`).join("") || `<li class="hint">Platziere Automaten, um dein Portfolio zu bewerten.</li>`;
}

// ---------- Panel: Einstellungen ----------

function renderAccountSection() {
  const el = $("#account-section");
  if (!el) return;
  const user = getUserInfo();
  if (getMode() !== "server" || !getServerStatus()?.authRequired) {
    el.innerHTML = "";
    return;
  }
  if (!user) {
    el.innerHTML = `<div class="account-card expired">
      <div class="who">Nicht angemeldet</div>
      <button class="btn tiny" id="btn-show-login">🔑 Anmelden</button>
    </div>`;
    $("#btn-show-login").addEventListener("click", showAuthOverlay);
    return;
  }
  const lic = user.license || {};
  const until = lic.validUntil ? new Date(lic.validUntil).toLocaleDateString("de-DE") : "unbegrenzt";
  el.innerHTML = `
    <div class="account-card ${lic.valid ? "" : "expired"}">
      <div class="who">👤 ${user.name} <span class="badge">${user.role === "admin" ? "Admin" : "Nutzer"}</span></div>
      <div class="lic">${user.email} · Lizenz: ${lic.valid ? `✅ ${lic.plan || "aktiv"} bis ${until}` : `❌ ${lic.reason || "ungültig"}`}</div>
      <div class="btn-row">
        ${user.role === "admin" ? `<a class="btn tiny" href="admin.html">🛠️ Admin-Oberfläche</a>` : ""}
        <button class="btn tiny ghost" id="btn-redeem">🎟️ Lizenzschlüssel einlösen</button>
        <button class="btn tiny ghost" id="btn-passwd">🔒 Passwort ändern</button>
        <button class="btn tiny ghost" id="btn-logout">🚪 Abmelden</button>
      </div>
    </div>`;
  $("#btn-redeem").addEventListener("click", async () => {
    const key = prompt("Lizenzschlüssel (SA-XXXX-…):");
    if (!key) return;
    try {
      await redeemLicense(key.trim());
      alert("Lizenz eingelöst – Laufzeit verlängert.");
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });
  $("#btn-passwd").addEventListener("click", async () => {
    const current = prompt("Aktuelles Passwort:");
    if (current === null) return;
    const next = prompt("Neues Passwort (min. 8 Zeichen):");
    if (next === null) return;
    try {
      await changePassword(current, next);
      alert("Passwort geändert.");
    } catch (e) {
      alert("Fehler: " + e.message);
    }
  });
  $("#btn-logout").addEventListener("click", async () => {
    await logout();
    showAuthOverlay();
  });
}

function renderSettingsPanel() {
  renderAccountSection();
  const s = state.settings;
  $("#set-capture").value = s.captureRatePct;
  $("#set-ticket").value = s.avgTicketEur;
  $("#set-margin").value = s.marginPct;
  $("#set-opex").value = s.opexPerMachineMonth;
  $("#set-buys").value = s.residentBuysPerYear;
  $("#set-refresh").value = s.autoRefreshHours;
  $("#set-season").checked = s.applySeasonality;
  $("#set-osm-machines").checked = s.includeOsmMachines;

  const srv = getServerStatus();
  const modeLine =
    getMode() === "server"
      ? `🖥️ Server-Modus: Deutschland-Datenbestand vom ${srv?.updatedAt ? new Date(srv.updatedAt).toLocaleString("de-DE") : "– (erstes Update läuft)"} · ${fmtNum(srv?.machines || 0)} Automaten · ${fmtNum(srv?.regionalPois || 0)} Hofläden/Märkte · ${fmtNum(srv?.population || 0)} Orte`
      : "🌐 Direkt-Modus (statisches Hosting): Daten werden je Kartenausschnitt live von der Overpass-API geladen.";
  const localLine = state.lastRefresh
    ? `Zuletzt geladen: ${new Date(state.lastRefresh).toLocaleString("de-DE")} · ${fmtNum(state.overpassPois.length)} POIs, ${fmtNum(state.osmMachines.length)} Automaten, ${fmtNum(state.populationCenters.length)} Orte im Speicher · ${state.hiddenOsmIds.length} ausgeblendet`
    : "Noch keine Daten geladen.";
  setRefreshStatus(modeLine + "\n" + localLine);
}

// ---------- Globale Aktionen ----------

function bindGlobalActions() {
  $("#radius-slider").addEventListener("input", (e) => {
    updateSettings({ radiusKm: Number(e.target.value) });
  });

  $("#btn-add-machine").addEventListener("click", () => {
    setClickMode("addMachine", (latlng) => {
      const name = prompt("Name des Automaten:", "Automat " + (state.machines.length + 1));
      if (!name) return;
      const isCompetitor = confirm("Ist das ein FREMDER Automat (Wettbewerber)?\nOK = Wettbewerber, Abbrechen = eigener Automat");
      const type = prompt("Typ (Snack / Getränke / Kombi / Pizza / Eis):", "Kombi") || "Kombi";
      addMachine({ name, type, lat: latlng.lat, lng: latlng.lng, isCompetitor });
    });
    alert("Klicke nun auf die Karte, um die Position des Automaten festzulegen.");
  });

  $("#btn-add-attraction").addEventListener("click", () => {
    setClickMode("addAttraction", (latlng) => {
      const name = prompt("Name der Attraktion:");
      if (!name) return;
      const visitors = prompt("Geschätzte Besucher pro Jahr:", "20000");
      const cat = prompt("Kategorie (kultur/freizeit/therme/natur/event/sport/einkauf):", "freizeit");
      addAttraction({ name, visitors, cat: CATEGORIES[cat] ? cat : "freizeit", lat: latlng.lat, lng: latlng.lng });
    });
    alert("Klicke nun auf die Karte, um die Position der Attraktion festzulegen.");
  });

  $("#btn-heatmap").addEventListener("click", () => {
    $("#btn-heatmap").disabled = true;
    setTimeout(() => {
      renderHeatmap();
      $("#btn-heatmap").disabled = false;
    }, 30);
  });

  $("#btn-suggest").addEventListener("click", () => {
    $("#btn-suggest").disabled = true;
    setTimeout(() => {
      const n = renderSuggestions();
      $("#btn-suggest").disabled = false;
      if (!n) alert("Keine geeigneten Standorte im aktuellen Kartenausschnitt gefunden. Zoome näher an eine Stadt heran.");
    }, 30);
  });

  $("#btn-save-settings").addEventListener("click", () => {
    updateSettings({
      captureRatePct: Number($("#set-capture").value),
      avgTicketEur: Number($("#set-ticket").value),
      marginPct: Number($("#set-margin").value),
      opexPerMachineMonth: Number($("#set-opex").value),
      residentBuysPerYear: Number($("#set-buys").value),
      autoRefreshHours: Number($("#set-refresh").value),
      applySeasonality: $("#set-season").checked,
      includeOsmMachines: $("#set-osm-machines").checked,
    });
    scheduleAutoRefresh(() => map.getBounds());
    alert("Einstellungen gespeichert.");
  });

  $("#btn-refresh-now").addEventListener("click", () => {
    refreshNow(map.getBounds()).then((res) => {
      if (res === "error")
        setRefreshStatus("❌ Aktualisierung fehlgeschlagen – später erneut versuchen.");
      else renderSettingsPanel();
    });
  });

  const doSearch = async () => {
    const q = $("#search-input").value.trim();
    if (!q) return;
    setDataStatus("⏳ suche…");
    try {
      const hit = await geocode(q);
      if (!hit) {
        setDataStatus("❓ Ort nicht gefunden");
        return;
      }
      setDataStatus("");
      map.setView([hit.lat, hit.lng], 13);
      state.selection = { lat: hit.lat, lng: hit.lng };
      notify("selection");
      loadViewport(map.getBounds());
    } catch {
      setDataStatus("⚠️ Suche fehlgeschlagen");
    }
  };
  $("#btn-search").addEventListener("click", doSearch);
  $("#search-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });

  $("#btn-restore-osm").addEventListener("click", () => {
    restoreHiddenOsmMachines();
    alert("Alle ausgeblendeten OSM-Automaten wurden wiederhergestellt.");
  });

  $("#btn-export").addEventListener("click", () => {
    download("standort-analyse-coburg.json", exportJson());
  });

  $("#btn-export-csv").addEventListener("click", () => {
    const rows = [["Name", "Typ", "Eigen/Wettbewerb", "Quelle", "Lat", "Lng", "Score", "Kunden/Tag", "Umsatz-Plan €/Jahr", "Gewinn-Plan €/Jahr", "Ist-Umsatz €/Monat"]];
    for (const m of allMachines()) {
      const r = analyzePoint(m.lat, m.lng);
      rows.push([m.name, m.type, m.isCompetitor ? "Wettbewerb" : "Eigen",
        m.source === "osm" ? "OpenStreetMap" : "manuell",
        m.lat.toFixed(5), m.lng.toFixed(5), r.score,
        r.customersDay.toFixed(1), r.revenueYear.toFixed(0),
        r.netProfitYear.toFixed(0), m.monthlySalesEur || ""]);
    }
    download("automaten-portfolio.csv",
      rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n"), "text/csv");
  });

  $("#file-import").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((t) => {
      try {
        importJson(t);
        alert("Import erfolgreich.");
      } catch (err) {
        alert("Import fehlgeschlagen: " + err.message);
      }
    });
    e.target.value = "";
  });

  $("#btn-print").addEventListener("click", () => window.print());
}

function download(filename, content, mime = "application/json") {
  const blob = new Blob([content], { type: mime + ";charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
