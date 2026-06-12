# 📍 Standort-Analyse Coburg

**Business-Intelligence-Tool für Automaten-Standorte in Coburg & Umkreis (30 km).**

Zeigt Attraktionen mit Besucherzahlen auf einer interaktiven Karte, berechnet das
Kundenpotenzial in frei wählbarem Umkreis, berücksichtigt bestehende Automaten
(eigene & Wettbewerber) und liefert Umsatz-/Gewinnprognosen, Standort-Scores,
eine Potenzial-Heatmap und automatische Standortvorschläge.

![Tech](https://img.shields.io/badge/Stack-Vanilla_JS_+_Leaflet-22d3ee) ![PWA](https://img.shields.io/badge/PWA-installierbar-34d399) ![Lizenz](https://img.shields.io/badge/Daten-OpenStreetMap-7ebc6f)

---

## 🚀 Schnellstart

Kein Build, keine Abhängigkeiten – nur ein statischer Webserver:

```bash
# Variante 1: Python
python3 -m http.server 8080

# Variante 2: Node
npx serve .
```

Dann <http://localhost:8080> öffnen. **Hinweis:** Wegen ES-Modulen und
Service-Worker muss die App über `http(s)://` laufen (nicht `file://`).

Für den Produktivbetrieb genügt jedes statische Hosting
(GitHub Pages, Netlify, eigener Server). HTTPS ist Voraussetzung für die
PWA-Installation auf Android.

## 🧭 Funktionen

| Funktion | Beschreibung |
|---|---|
| **Karte mit Attraktionen** | 22 kuratierte Attraktionen (Veste Coburg, Sambafestival, Thermen, Basilika Vierzehnheiligen …) mit gepflegten Jahresbesucherzahlen, Markergröße ∝ Besucheraufkommen |
| **Umkreis-Analyse** | Klick auf die Karte → Kundenpotenzial, Umsatz- und Gewinnprognose für 0,3–10 km Radius |
| **Automaten-Verwaltung** | Eigene & fremde Automaten manuell auf der Karte platzieren – sie fließen als Wettbewerb/Kannibalisierung in jede Berechnung ein |
| **Ist-Daten-Abgleich** | Realen Monatsumsatz je Automat erfassen → Plan/Ist-Abweichung im Portfolio |
| **Potenzial-Heatmap** | Raster-Scoring über den Kartenausschnitt (grün/gelb/rot) |
| **Standort-Vorschläge** | Top-5 freie Standorte im Kartenausschnitt mit Mindestabstand |
| **Business-Dashboard** | Portfolio-KPIs, Saisonverlauf, Kategorie-Mix, Standort-Ranking, CSV-Export, Druckbericht |
| **Automatische Datenpflege** | Periodischer POI-Abgleich über die OpenStreetMap-Overpass-API (inkl. bereits kartierter Verkaufsautomaten), konfigurierbares Intervall |
| **Saisonalität** | Monatsfaktoren je Kategorie (Sambafestival im Juli, Thermen im Winter, Weihnachtsmarkt im Dezember) |
| **Backup & Import** | Alle Nutzdaten als JSON exportieren/importieren; Persistenz lokal im Browser |
| **PWA / Android-App** | Offline-fähig, auf dem Smartphone installierbar (s. u.) |

## 📐 Rechenmodell

Das Kundenpotenzial eines Punktes setzt sich zusammen aus:

1. **Besucherströme**: `Σ Besucher × Distanz-Decay × Verweildauer-Gewicht × Saisonfaktor`
   über alle Attraktionen im Radius. Decay = Gravitationsmodell `1/(1+(d/0,8 km)²)`.
2. **Wohnbevölkerung**: 20 Bevölkerungsschwerpunkte der Region (amtliche
   Einwohnerzahlen) × Kauffrequenz × Decay.
3. **Capture-Rate**: konfigurierbarer Anteil der Passanten, die tatsächlich kaufen.
4. **Wettbewerb**: jeder Automat im Radius reduziert den Marktanteil
   anteilig nach Nähe (`Anteil = 1/(1+Σ decay(d_i))`).
5. **Wirtschaftlichkeit**: Umsatz = Kunden × Ø-Bon; Gewinn = Umsatz × Marge − Betriebskosten.

Alle Parameter (Capture-Rate, Ø-Bon, Marge, Betriebskosten, Kauffrequenz) sind
unter **⚙️ Einstellungen** an das eigene Geschäftsmodell anpassbar.
Der Standort-Score (0–100) skaliert logarithmisch; 30 Kunden/Tag ≈ 100 Punkte.

> ⚠️ Die Besucherzahlen sind kuratierte Schätzwerte aus öffentlichen Quellen
> bzw. Heuristiken je POI-Typ – ein Prognosewerkzeug, kein Ersatz für
> Vor-Ort-Frequenzmessung.

## 🔄 Automatische Datenaktualisierung (inkl. farmshops.eu-Daten)

- POIs (Museen, Freizeitparks, Bäder, Arenen, Einkaufszentren, Kinos …) werden
  über die **Overpass-API** im 30-km-Umkreis von Coburg geladen und mit
  heuristischen Besucherzahlen versehen.
- **farmshops.eu-Datenmodell integriert**: farmshops.eu ist selbst nur eine
  Aufbereitung von OpenStreetMap-Daten
  ([Quellcode](https://github.com/CodeforKarlsruhe/farmshops.eu)). Dieses Tool
  übernimmt dieselbe Abfrage direkt aus der Quelle (OSM/Overpass) – täglich
  und ohne Umweg:
  - **Verkaufsautomaten** (`vending=` milk, egg, food, cheese, sausage, meat,
    potato, noodle, honey, fruit, bread … sowie klassische Snack-/Getränke-/
    Pizza-/Eisautomaten, ohne Tierfutter) → fließen automatisch als
    **Wettbewerber in die Potenzialberechnung** ein. Einzelne Automaten lassen
    sich ausblenden (✕) und in den Einstellungen wiederherstellen; der
    Schalter „als Wettbewerb einrechnen" deaktiviert sie komplett.
  - **Hofläden** (`shop=farm`), **Wochenmärkte** (`amenity=marketplace`) und
    **Imkereien** (`craft=beekeeper`) → erscheinen als Frequenzbringer
    (Kategorie „Hofladen & Markt").
- Intervall in den Einstellungen konfigurierbar (Standard: alle 24 h = täglich,
  beim App-Start wird die Fälligkeit geprüft). Manuell: „🔄 Jetzt aktualisieren".
- Kuratierte Attraktionen werden bei Namensgleichheit nicht dupliziert;
  OSM-Automaten in < 50 m Nähe zu manuell erfassten ebenfalls nicht.

## 📱 Android-App

Die App ist eine vollwertige **PWA** und damit direkt installierbar:

1. App unter HTTPS hosten (z. B. GitHub Pages).
2. Auf dem Android-Gerät in Chrome öffnen → Menü → **„App installieren"**.
3. Die App läuft danach als eigenständige App mit Icon, Vollbild und Offline-Modus.

**Für den Google Play Store** (Trusted Web Activity, ~10 Minuten):

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://DEINE-DOMAIN/manifest.webmanifest
bubblewrap build   # erzeugt signierte .aab/.apk für den Play Store
```

## 🗂️ Projektstruktur

```
index.html              App-Shell & Panels
css/style.css           Dark-Theme, responsive, Druck-Layout
js/data.js              Kuratierte Attraktionen, Bevölkerung, Saisonfaktoren
js/store.js             State + localStorage-Persistenz + Import/Export
js/analysis.js          Analyse-Engine (Gravitationsmodell, Scoring, Vorschläge)
js/overpass.js          Auto-Aktualisierung über OpenStreetMap Overpass-API
js/map.js               Leaflet-Karte, Layer, Heatmap, Pins
js/ui.js                Panels, Dashboard, Export, Berichte
js/charts.js            Abhängigkeitsfreie Canvas-Charts
sw.js                   Service Worker (offline / PWA)
manifest.webmanifest    PWA-Manifest (Android-Installation)
```

## 🛣️ Roadmap zur Skalierung

Das Tool ist bewusst serverlos gestartet (null Betriebskosten, sofort
einsetzbar). Ausbaustufen Richtung Multi-Region/Multi-User-Plattform:

1. **Backend & Sync** – Postgres/PostGIS + REST-API; Team-Accounts statt
   localStorage; Audit-Log.
2. **Echte Frequenzdaten** – Anbindung von Mobilfunk-Bewegungsdaten,
   Google Popular Times, Veranstaltungskalendern und Telemetrie der eigenen
   Automaten (Verkäufe je Stunde) zur automatischen Modell-Kalibrierung.
3. **Beliebige Regionen** – Geocoding + Zensus-Rasterdaten (100 m-Gitter)
   statt kuratierter Ortsliste; das Rechenmodell ist bereits regionsneutral.
4. **Routenoptimierung** – Befüllungstouren (TSP) über das eigene Portfolio.
5. **ML-Forecasting** – Umsatzprognose je Standort aus Ist-Daten
   (Plan/Ist-Erfassung ist als Trainingsdaten-Grundlage schon eingebaut).
6. **White-Label/B2B** – das gleiche Modell trägt jedes frequenzbasierte
   Geschäft: Foodtrucks, Pop-up-Retail, Werbeflächen, Ladesäulen.

## Datenquellen & Lizenz

Kartenmaterial & POIs: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende (ODbL).
Besucherzahlen: kuratierte Schätzwerte aus öffentlichen Quellen (Stand 2026), Einwohnerzahlen gerundet nach amtlicher Statistik.
