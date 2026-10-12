# Frontend OndeJoga (React + Vite) servido pelo Nginx, com proxy de /api.
FROM node:20-alpine AS build

WORKDIR /app

# Playwright só é usado nos testes e2e da máquina local; o container não
# precisa dos navegadores (evita baixar ~300 MB em todo build).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=5 \
    CMD wget -q -O /dev/null http://127.0.0.1/api/health || exit 1
