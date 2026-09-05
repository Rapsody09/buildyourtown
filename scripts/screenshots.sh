#!/usr/bin/env bash
# Régénère les captures du README (docs/screenshots/*.png, 1920×1080) à partir
# de l'image de production, pour que le badge de version corresponde à
# package.json. Tout tourne dans Docker : l'image du jeu sur un réseau dédié,
# Chrome headless (zenika/alpine-chrome) qui la vise par son nom de conteneur.
#
# Usage : scripts/screenshots.sh        (≈ 1 min)
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
IMG=buildyourtown/web:screenshots
NET=buildyourtown-screenshots
APP=buildyourtown-screenshots
OUT="$PWD/docs/screenshots"

cleanup() {
  docker rm -f "$APP" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "=== image de production (v$VERSION)"
docker build -q --build-arg APP_VERSION="$VERSION" -t "$IMG" . >/dev/null
docker network create "$NET" >/dev/null
docker run -d --name "$APP" --network "$NET" "$IMG" >/dev/null
for _ in $(seq 1 30); do
  docker exec "$APP" wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 && break
  sleep 1
done

shot() {
  local name=$1 query=$2
  docker run --rm --network "$NET" -u "$(id -u):$(id -g)" -v "$OUT:/out" zenika/alpine-chrome:latest \
    --headless --no-sandbox --disable-gpu --hide-scrollbars --window-size=1920,1080 \
    --virtual-time-budget=7000 --screenshot="/out/$name.png" "http://$APP:8080/?$query" >/dev/null 2>&1
  echo "  $name.png"
}

echo "=== captures"
shot overview 'demo=12&showcase&lang=fr'
shot closeup  'demo=12&showcase&zoom=1&lang=fr'
shot welcome  'demo=1&welcome&lang=fr'
shot budget   'demo=12&panel=budget&lang=fr'
shot traffic  'demo=12&map=traffic&lang=fr'
echo "✓ captures dans docs/screenshots (v$VERSION)"
