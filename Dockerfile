# Image de production : build Vite dans node, puis nginx non privilégié qui
# sert le dossier dist/ (site 100 % statique, aucune donnée côté serveur).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="BuildYourTown" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.source="https://github.com/Rapsody09/buildyourtown"
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.inc /etc/nginx/conf.d/security-headers.inc
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
