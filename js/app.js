/**
 * Bootstrap: Store laden, Karte & UI initialisieren,
 * Auto-Refresh planen, Service-Worker (PWA / Android) registrieren.
 */
import { load } from "./store.js";
import { initMap } from "./map.js";
import { initUi } from "./ui.js";
import { scheduleAutoRefresh } from "./overpass.js";

load();
initMap();
initUi();
scheduleAutoRefresh();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) =>
    console.warn("Service-Worker-Registrierung fehlgeschlagen:", e)
  );
}
