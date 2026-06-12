# 📍 Standort-Analyse Deutschland

**Business-Intelligence-Tool für Automaten-Standorte – deutschlandweit.**

Zeigt Attraktionen mit Besucherzahlen auf einer interaktiven Karte, berechnet das
Kundenpotenzial in frei wählbarem Umkreis, berücksichtigt bestehende Automaten
(eigene & Wettbewerber, automatisch aus OpenStreetMap/farmshops übernommen) und
liefert Umsatz-/Gewinnprognosen, Standort-Scores, eine Potenzial-Heatmap und
automatische Standortvorschläge.

![Tech](https://img.shields.io/badge/Stack-Vanilla_JS_+_Leaflet_+_Node-22d3ee) ![PWA](https://img.shields.io/badge/PWA-installierbar-34d399) ![Lizenz](https://img.shields.io/badge/Daten-OpenStreetMap-7ebc6f)

---

## 🚀 Schnellstart

### Variante A: Server-Modus (empfohlen, z. B. im LXC-Container)

Node ≥ 18, keine npm-Abhängigkeiten:

```bash
node server/server.mjs          # läuft auf http://0.0.0.0:8080
```

Der Server liefert die Web-App aus, lädt **einmal täglich ganz Deutschland**
(alle Verkaufsautomaten, Hofläden, Wochenmärkte, Imkereien + Einwohnerzahlen
aller Städte/Gemeinden aus OSM) in `data/germany.json` und beantwortet die
Kartenabfragen aus diesem Bestand. Erststart: Das erste Deutschland-Update
beginnt nach ~10 s und dauert einige Minuten.

Manuelles Datenupdate: `npm run update-data` · Konfiguration über
Umgebungsvariablen `PORT`, `UPDATE_INTERVAL_H`, `DATA_DIR`, `REQUIRE_AUTH`,
`ADMIN_EMAIL`, `ADMIN_PASSWORD`.

## 🔐 Accounts, Lizenzen & Admin (Monetarisierung)

Der Server enthält ein vollständiges Account-System – die Daten-API ist nur
mit **gültiger Lizenz** nutzbar. So lassen sich Zugänge verkaufen:

1. **Admin-Konto**: wird beim ersten Start automatisch angelegt. E-Mail/Passwort
   über `ADMIN_EMAIL`/`ADMIN_PASSWORD` setzen – ohne diese Variablen wird ein
   Zufallspasswort generiert und **einmalig im Log ausgegeben**
   (`journalctl -u standort-analyse`). Nach dem ersten Login ändern.
2. **Lizenzschlüssel erzeugen**: In der **Admin-Oberfläche** (`/admin.html`,
   Link auch im ⚙️-Tab) Schlüssel mit Plan (Standard/Pro/Test), Laufzeit in
   Tagen und Stückzahl generieren – z. B. „Pro, 365 Tage" als Jahreslizenz.
   Den Schlüssel (`SA-XXXX-XXXX-XXXX-XXXX`) verkaufst du an den Kunden.
3. **Kunde registriert sich** auf der Startseite mit E-Mail, Passwort und dem
   Schlüssel (Registrierung ist *nur* mit gültigem Schlüssel möglich; jeder
   Schlüssel ist einmal einlösbar). Verlängerung: weiteren Schlüssel kaufen
   und im ⚙️-Tab einlösen – Laufzeiten addieren sich.
4. **Verwaltung**: Die Admin-Oberfläche zeigt Statistiken (aktive Lizenzen,
   bald ablaufende), alle Konten mit Lizenzstatus und letztem Login und kann
   je Nutzer verlängern (+30 T/+1 Jahr), sperren, Passwort zurücksetzen,
   löschen sowie unbenutzte Schlüssel widerrufen und das Deutschland-
   Datenupdate anstoßen.

Technik: scrypt-Passwort-Hashes, HttpOnly-Session-Cookies (30 Tage),
Login-Rate-Limit, Persistenz in `data/users.json`/`licenses.json`/`sessions.json`
(im Backup des Containers mitsichern!). `REQUIRE_AUTH=0` deaktiviert die
Lizenzpflicht (z. B. für eine offene Demo). Abgelaufene Lizenz oder gesperrtes
Konto ⇒ API liefert 401/403, das Frontend zeigt den Anmelde-/Lizenzdialog.
Hinter einem HTTPS-Reverse-Proxy betreiben, wenn aus dem Internet erreichbar.

### Variante B: Statisch (ohne Backend)

```bash
python3 -m http.server 8080
```

Die App erkennt automatisch, dass kein Server-API verfügbar ist, und lädt die
Daten je Kartenausschnitt direkt von der Overpass-API („Direkt-Modus").

## 📦 Hosting im LXC-Container (Proxmox & Co.)

Frischen Debian-/Ubuntu-Container erstellen, dann als root:

```bash
git clone https://github.com/BlattTV/aris.git /opt/standort-analyse
bash /opt/standort-analyse/deploy/install-lxc.sh
```

Das Skript installiert Node, legt einen Systemnutzer an, richtet zwei
systemd-Units ein und startet alles:

| Unit | Zweck |
|---|---|
| `standort-analyse.service` | Web-App + API + tägliches Deutschland-Update |
| `standort-analyse-update.timer` | zieht alle 15 min Code-Updates per `git pull` und startet bei Änderungen neu |

**Damit landen Änderungen, die hier im Repository gepusht werden, automatisch
binnen 15 Minuten im Container** – manuell geht es jederzeit mit
`bash /opt/standort-analyse/deploy/update.sh`. Branch/Repo sind über die
Variablen `BRANCH`/`REPO_URL` des Install-Skripts steuerbar.

Logs: `journalctl -u standort-analyse -f` · Status: `systemctl status standort-analyse`

## 🧭 Funktionen

| Funktion | Beschreibung |
|---|---|
| **Deutschlandweite Karte** | Ortssuche (Nominatim), Daten werden je Kartenausschnitt nachgeladen; dazu 22 kuratierte Attraktionen der Region Coburg mit gepflegten Besucherzahlen |
| **Umkreis-Analyse** | Klick auf die Karte → Kundenpotenzial, Umsatz- und Gewinnprognose für 0,3–10 km Radius; Einwohner aus OSM-Bevölkerungsdaten aller deutschen Städte/Gemeinden |
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
2. **Wohnbevölkerung**: OSM-place-Nodes (Städte/Gemeinden/Dörfer mit
   `population`-Tag, deutschlandweit) × Kauffrequenz × Decay; für die Region
   Coburg zusätzlich 20 kuratierte amtliche Einwohnerzahlen.
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

**farmshops.eu-Datenmodell integriert**: farmshops.eu ist selbst nur eine
Aufbereitung von OpenStreetMap-Daten
([Quellcode](https://github.com/CodeforKarlsruhe/farmshops.eu)). Dieses Tool
übernimmt dieselbe Abfrage direkt aus der Quelle (OSM/Overpass):

- **Verkaufsautomaten** (`vending=` milk, egg, food, cheese, sausage, meat,
  potato, noodle, honey, fruit, bread … sowie klassische Snack-/Getränke-/
  Pizza-/Eisautomaten, ohne Tierfutter) → fließen automatisch als
  **Wettbewerber in die Potenzialberechnung** ein. Einzelne Automaten lassen
  sich ausblenden (✕) und wiederherstellen; ein Schalter deaktiviert sie komplett.
- **Hofläden** (`shop=farm`), **Wochenmärkte** (`amenity=marketplace`) und
  **Imkereien** (`craft=beekeeper`) → Frequenzbringer (Kategorie „Hofladen & Markt").
- **Bevölkerung**: alle deutschen `place`-Nodes mit `population`-Tag.
- **Frequenzbringer-POIs** (Museen, Freizeitparks, Bäder, Arenen, Kinos,
  Einkaufszentren …) mit heuristischen Besucherzahlen.

**Server-Modus**: Der Node-Server lädt das komplette Deutschland-Datenmodell
**einmal täglich** (konfigurierbar via `UPDATE_INTERVAL_H`) und hält es in
`data/germany.json` vor; POI-Tiles werden 24 h gecacht. Ein leerer/fehlgeschlagener
Update-Lauf überschreibt nie einen guten Bestand. Manuell: Button
„🔄 Jetzt aktualisieren" (stößt das Server-Update an) oder `npm run update-data`.

**Direkt-Modus** (statisches Hosting): identische Daten, je Kartenausschnitt
live von der Overpass-API geladen.

Dubletten-Schutz: kuratierte Attraktionen bei Namensgleichheit, OSM-Automaten
in < 50 m Nähe zu manuell erfassten.

## 📱 Android-App (APK)

Im Ordner `android/` liegt eine native Android-App (WebView-Wrapper, keine
externen Abhängigkeiten). Beim ersten Start fragt sie die Adresse deines
Servers ab (z. B. `http://192.168.1.50:8080` für den LXC-Container im LAN)
und merkt sie sich; Portfolio-Daten bleiben in der App gespeichert.

**APK bauen lassen (ohne lokales Android-Studio):** Der GitHub-Actions-Workflow
[`android-apk.yml`](.github/workflows/android-apk.yml) baut bei jedem Push auf
`android/**` – oder manuell über *Actions → „Android APK bauen" → Run workflow* –
eine installierbare Debug-APK und legt sie als Artefakt `standort-analyse-apk`
zum Download ab. Auf dem Handy: APK herunterladen, Installation aus unbekannten
Quellen erlauben, installieren.

**Lokal bauen:** `cd android && gradle assembleDebug` (Android SDK + Java 17 nötig).

Alternativ ist die Web-App weiterhin eine vollwertige **PWA**: unter HTTPS
gehostet lässt sie sich in Chrome über „App installieren" ohne APK installieren.
Für den Play Store: Bubblewrap/TWA (benötigt HTTPS-Domain).

## 🗂️ Projektstruktur

```
index.html              App-Shell & Panels
css/style.css           Dark-Theme, responsive, Druck-Layout
js/data.js              Kuratierte Attraktionen, Bevölkerung (Seed), Saisonfaktoren
js/queries.mjs          Gemeinsame Overpass-Abfragen + Parsing (Client & Server)
js/api.js               Datenprovider: Server-API oder direkter Overpass-Zugriff
js/store.js             State + localStorage-Persistenz + Merge + Import/Export
js/analysis.js          Analyse-Engine (Gravitationsmodell, Scoring, Vorschläge)
js/map.js               Leaflet-Karte, Layer, Heatmap, Viewport-Nachladen
js/ui.js                Panels, Dashboard, Suche, Export, Berichte
js/charts.js            Abhängigkeitsfreie Canvas-Charts
js/auth.js              Login/Registrierung/Lizenz (Client)
admin.html + js/admin.js  Admin-Oberfläche (Konten, Lizenzen, Betrieb)
sw.js                   Service Worker (offline / PWA)
manifest.webmanifest    PWA-Manifest
server/server.mjs       Node-Server: Statik + API + tägliches Deutschland-Update
server/auth.mjs         Accounts, Lizenzschlüssel, Sessions (scrypt, Cookies)
server/update-data.mjs  Standalone-Datenupdate (Cron-tauglich)
deploy/                 LXC-Installation, systemd-Units, Git-Auto-Update
android/                Android-App (WebView), APK via GitHub Actions
```

## 🛣️ Roadmap zur Skalierung

Erreicht: ✅ deutschlandweite Abdeckung, ✅ eigener Server mit täglicher
Datenpflege, ✅ Android-App, ✅ Accounts + Lizenzverkauf + Admin-Oberfläche.
Nächste Ausbaustufen:

1. **Portfolio-Sync** – Automaten/Einstellungen serverseitig je Konto statt
   localStorage (Mehrgeräte-Sync, Team-Freigaben); bei Wachstum Postgres/
   PostGIS statt JSON-Dateien. Zahlungsanbindung (Stripe/PayPal) für
   automatischen Schlüsselversand.
2. **Echte Frequenzdaten** – Mobilfunk-Bewegungsdaten, Google Popular Times,
   Veranstaltungskalender und Telemetrie der eigenen Automaten (Verkäufe je
   Stunde) zur automatischen Modell-Kalibrierung.
3. **Zensus-Rasterdaten** – 100 m-Bevölkerungsgitter statt place-Nodes für
   präzisere Einzugsgebiete.
4. **Routenoptimierung** – Befüllungstouren (TSP) über das eigene Portfolio.
5. **ML-Forecasting** – Umsatzprognose je Standort aus Ist-Daten
   (Plan/Ist-Erfassung ist als Trainingsdaten-Grundlage schon eingebaut).
6. **White-Label/B2B** – das gleiche Modell trägt jedes frequenzbasierte
   Geschäft: Foodtrucks, Pop-up-Retail, Werbeflächen, Ladesäulen.

## Datenquellen & Lizenz

Kartenmaterial & POIs: © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende (ODbL).
Besucherzahlen: kuratierte Schätzwerte aus öffentlichen Quellen (Stand 2026), Einwohnerzahlen gerundet nach amtlicher Statistik.
