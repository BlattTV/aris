#!/usr/bin/env bash
#
# Code-Update aus dem Git-Repository einspielen und Dienst neu starten,
# wenn es Änderungen gab. Kann manuell oder per systemd-Timer laufen.
#
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/standort-analyse}"
BRANCH="${BRANCH:-$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)}"

cd "$APP_DIR"
OLD=$(git rev-parse HEAD)
git fetch origin "$BRANCH" --quiet
git reset --hard "origin/$BRANCH" --quiet
NEW=$(git rev-parse HEAD)

if [ "$OLD" != "$NEW" ]; then
  echo "Update eingespielt: ${OLD:0:7} → ${NEW:0:7} – Dienst wird neu gestartet."
  chown -R standortanalyse:standortanalyse "$APP_DIR" 2>/dev/null || true
  systemctl restart standort-analyse
else
  echo "Kein Update verfügbar (${OLD:0:7})."
fi
