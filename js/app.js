/**
 * Bootstrap: Store laden, Betriebsart erkennen (Server-API oder direkter
 * Overpass-Zugriff), Karte & UI initialisieren, Auto-Refresh planen,
 * Service-Worker (PWA / Android) registrieren.
 */
import { load } from "./store.js";
import { detectMode, scheduleAutoRefresh } from "./api.js";
import { initMap, map } from "./map.js";
import { initUi } from "./ui.js";

load();
await detectMode();
initMap();
initUi();
scheduleAutoRefresh(() => map.getBounds());

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch((e) =>
    console.warn("Service-Worker-Registrierung fehlgeschlagen:", e)
  );
}
