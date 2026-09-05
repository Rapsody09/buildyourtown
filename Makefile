.PHONY: image dev build typecheck lock sh prod-image prod-run screenshots

# Reconstruit l'image (à refaire quand package.json change)
image:
	docker compose build

# Serveur de dev avec rechargement à chaud : http://localhost:5173
dev:
	docker compose up

# Typecheck + build de prod dans dist/
build:
	docker compose run --rm --no-deps -T node npm run build

typecheck:
	docker compose run --rm --no-deps -T node npm run typecheck

# Régénère package-lock.json (sans écrire node_modules sur l'hôte)
lock:
	docker run --rm -u 1000:1000 -e npm_config_cache=/tmp/.npm \
	  -v "$$PWD":/app -w /app node:22-alpine \
	  npm install --package-lock-only --no-audit --no-fund

sh:
	docker compose run --rm --no-deps node sh

# Simulation headless pour vérifier l'équilibrage : make simtest ARGS="30 12345 7 mixed"
simtest:
	docker compose run --rm --no-deps -T node sh -c \
	  'npx esbuild scripts/simtest.ts --bundle --platform=node --format=esm --log-level=warning --outfile=/tmp/simtest.mjs && node /tmp/simtest.mjs $(ARGS)'

# Version lue dans package.json (affichée dans le jeu et posée en label sur l'image)
VERSION := $(shell sed -n 's/.*"version": "\([^"]*\)".*/\1/p' package.json)

# Image de production (nginx + dist/) et test local sur http://localhost:8081
prod-image:
	docker build --build-arg APP_VERSION=$(VERSION) -t buildyourtown/web:local -t buildyourtown/web:$(VERSION) .

prod-run: prod-image
	docker run --rm -p 127.0.0.1:8081:8080 buildyourtown/web:local

# Captures du README (docs/screenshots), prises sur l'image de production
screenshots:
	scripts/screenshots.sh
