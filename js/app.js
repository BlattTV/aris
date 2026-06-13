/**
 * Bootstrap: Store laden, Betriebsart erkennen (Server-API oder direkter
 * Overpass-Zugriff), Anmeldung prüfen, Portfolio-Sync starten, Karte & UI
 * initialisieren, Auto-Refresh planen, Service-Worker registrieren.
 */
import { load } from "./store.js";
import { detectMode, getServerStatus, scheduleAutoRefresh, loadViewport } from "./api.js";
import { fetchMe, initAuthUi, showAuthOverlay } from "./auth.js";
import { initSync, loadTeamMachines } from "./sync.js";
import { initMap, map } from "./map.js";
import { initUi } from "./ui.js";
import { updateVerticalLabels } from "./verticals.js";

load();
const mode = await detectMode();

// White-Label-Branding der Instanz (BRAND_NAME des Servers)
const brand = getServerStatus()?.brand;
if (brand) {
  document.title = brand;
  const h1 = document.querySelector(".brand h1");
  if (h1) h1.textContent = brand;
}

let authed = true;
if (mode === "server" && getServerStatus()?.authRequired) {
  authed = !!(await fetchMe());
}

async function afterLogin() {
  await initSync();          // Portfolio vom Server übernehmen/pushen
  loadTeamMachines();        // Team-Standorte (Freigaben) einblenden
  loadViewport(map.getBounds(), { force: true });
}

initMap();
initUi();
updateVerticalLabels();
initAuthUi(afterLogin);
if (!authed) showAuthOverlay();
else if (mode === "server" && getServerStatus()?.authRequired) afterLogin();
scheduleAutoRefresh(() => map.getBounds());

// Rückkehr vom Stripe-Checkout
const params = new URLSearchParams(location.search);
if (params.get("payment") === "success") {
  history.replaceState(null, "", location.pathname);
  setTimeout(async () => {
    await fetchMe(); // Lizenzstatus aktualisieren (Webhook hat verlängert)
    alert("Zahlung erfolgreich – deine Lizenz wurde verlängert. Danke!");
  }, 800);
} else if (params.get("payment") === "cancel") {
  history.replaceState(null, "", location.pathname);
}

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) =>
    console.warn("Service-Worker-Registrierung fehlgeschlagen:", e)
  );
}
