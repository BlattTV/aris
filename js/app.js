/**
 * Bootstrap: Store laden, Betriebsart erkennen (Server-API oder direkter
 * Overpass-Zugriff), Anmeldung prüfen (Server-Modus mit Lizenzpflicht),
 * Karte & UI initialisieren, Auto-Refresh planen, Service-Worker registrieren.
 */
import { load } from "./store.js";
import { detectMode, getServerStatus, scheduleAutoRefresh, loadViewport } from "./api.js";
import { fetchMe, initAuthUi, showAuthOverlay } from "./auth.js";
import { initMap, map } from "./map.js";
import { initUi } from "./ui.js";

load();
const mode = await detectMode();

let authed = true;
if (mode === "server" && getServerStatus()?.authRequired) {
  authed = !!(await fetchMe());
}

initMap();
initUi();
initAuthUi(() => loadViewport(map.getBounds(), { force: true }));
if (!authed) showAuthOverlay();
scheduleAutoRefresh(() => map.getBounds());

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) =>
    console.warn("Service-Worker-Registrierung fehlgeschlagen:", e)
  );
}
