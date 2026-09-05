#!/usr/bin/env bash
# Publie une nouvelle version de BuildYourTown, de bout en bout :
#   1. bump de version (package.json + package-lock.json, via npm dans le conteneur)
#   2. README : ligne « Version X.Y.Z »
#   3. CHANGELOG.md : la section « ## X.Y.Z — AAAA-MM-JJ » doit déjà exister
#      (rédigée à la main ou par le skill /release), sinon le script s'arrête
#   4. typecheck + build de production
#   5. captures du README régénérées avec le nouveau badge de version
#   6. commit « release: vX.Y.Z », tag vX.Y.Z, push (branche + tag)
#   7. build + push de l'image et redéploiement (script du dépôt infra)
#   8. vérification : le site sert bien la nouvelle version
#
# Usage : scripts/release.sh <patch|minor|major|X.Y.Z> [--no-deploy]
set -euo pipefail

cd "$(dirname "$0")/.."
BUMP="${1:-}"
DEPLOY=1
[[ "${2:-}" == "--no-deploy" ]] && DEPLOY=0
if [[ -z "$BUMP" ]]; then
  echo "usage : scripts/release.sh <patch|minor|major|X.Y.Z> [--no-deploy]" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "ERREUR : des modifications ne sont pas commitées. Commiter d'abord (la release ne doit contenir que le bump)." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

OLD=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
docker compose run --rm --no-deps -T node npm version "$BUMP" --no-git-tag-version >/dev/null
NEW=$(sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)
echo "version : $OLD → $NEW"

if ! grep -q "^## $NEW — " CHANGELOG.md; then
  git checkout -- package.json package-lock.json
  echo "ERREUR : CHANGELOG.md n'a pas de section « ## $NEW — AAAA-MM-JJ ». Rédige les notes de version, puis relance." >&2
  exit 1
fi
sed -i "s/^Version [0-9][0-9.]*/Version $NEW/" README.md

echo "=== typecheck + build"
make build >/dev/null

echo "=== captures d'écran"
scripts/screenshots.sh

git add package.json package-lock.json README.md CHANGELOG.md docs/screenshots
git commit -q -m "release: v$NEW"
git tag -a "v$NEW" -m "BuildYourTown v$NEW"
echo "=== push"
git push origin main --follow-tags

if [[ "$DEPLOY" == "1" ]]; then
  echo "=== image + déploiement"
  ~/infra/scripts/build-push-buildyourtown.sh
  echo "=== vérification en ligne"
  sleep 5
  ASSET=$(curl -s --max-time 20 https://buildyourtown.com/ | grep -o '/assets/index-[^"]*\.js' | head -1 || true)
  if [[ -n "$ASSET" ]] && curl -s --max-time 20 "https://buildyourtown.com$ASSET" | grep -q "v$NEW"; then
    echo "✓ https://buildyourtown.com sert la version $NEW"
  else
    echo "⚠️  la version $NEW n'est pas encore visible en ligne (cache ou déploiement en cours) : recharger dans une minute." >&2
  fi
fi
echo "✓ release v$NEW terminée"
