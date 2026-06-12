#!/bin/sh
#
# Container-Entrypoint. Zwei Betriebsarten:
#   Standard:        startet den Server aus dem im Image enthaltenen Code.
#   AUTO_UPDATE=1:   zieht beim Start und danach alle 15 min Code-Updates
#                    per git aus REPO_URL/BRANCH und startet bei Änderungen
#                    neu – so landen gepushte Änderungen ohne Image-Rebuild
#                    im Container.
#
set -u
cd /app

if [ "${AUTO_UPDATE:-0}" != "1" ]; then
  exec node server/server.mjs
fi

REPO_URL="${REPO_URL:-https://github.com/BlattTV/aris.git}"
BRANCH="${BRANCH:-main}"
CHECK_SECONDS="${UPDATE_CHECK_SECONDS:-900}"

if [ ! -d /app/.git ]; then
  echo "Auto-Update: klone $REPO_URL ($BRANCH) …"
  rm -rf /tmp/repo && git clone --branch "$BRANCH" "$REPO_URL" /tmp/repo \
    && cp -a /tmp/repo/. /app/ || echo "Klonen fehlgeschlagen – nutze Image-Stand"
fi

echo "Auto-Update aktiv: $REPO_URL ($BRANCH), Prüfintervall ${CHECK_SECONDS}s"

while true; do
  if [ -d /app/.git ]; then
    git fetch origin "$BRANCH" >/dev/null 2>&1 \
      && git reset --hard "origin/$BRANCH" >/dev/null 2>&1 \
      && echo "Code-Stand: $(git rev-parse --short HEAD)" \
      || echo "git-Update fehlgeschlagen – nutze vorhandenen Stand"
  fi

  node server/server.mjs &
  PID=$!
  RESTART=0

  while kill -0 "$PID" 2>/dev/null; do
    sleep "$CHECK_SECONDS"
    kill -0 "$PID" 2>/dev/null || break
    REMOTE=$(git ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1)
    LOCAL=$(git rev-parse HEAD 2>/dev/null)
    if [ -n "$REMOTE" ] && [ -n "$LOCAL" ] && [ "$REMOTE" != "$LOCAL" ]; then
      echo "Neues Code-Update gefunden ($REMOTE) – Neustart"
      RESTART=1
      kill "$PID"
      wait "$PID" 2>/dev/null
      break
    fi
  done

  if [ "$RESTART" != "1" ]; then
    # Server hat sich selbst beendet → Container beenden,
    # die Docker-Restart-Policy übernimmt.
    wait "$PID" 2>/dev/null
    exit 1
  fi
done
