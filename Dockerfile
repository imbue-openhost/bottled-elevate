# ---- Stage 1: build the Angular web app ----
FROM node:20-bookworm AS build
WORKDIR /build/appcore

# 1) Dependency install — this layer is cached unless the manifests or the shared
#    library change, so ordinary app-source edits don't reinstall node_modules.
#    @elevate/shared is a file: dependency, so modules/ must exist for `npm ci`.
#    Skip lifecycle scripts here: the ngcc postinstall needs the app sources
#    (it targets packages referenced by tsconfig.app.json), so it runs below.
COPY appcore/package.json appcore/package-lock.json ./
COPY appcore/modules ./modules
RUN npm ci --ignore-scripts

# 2) App sources — copied late so editing them does NOT re-run `npm ci`.
#    Root package.json is read by @elevate/shared (app-package.ts) at /build/package.json.
COPY package.json /build/package.json
COPY appcore ./
RUN npm run postinstall \
    && npm run build -- --configuration=web-prod
# Output: /build/dist/app

# ---- Stage 2: serve static build + proxy the health-data service ----
FROM python:3.12-slim AS serve
WORKDIR /app

RUN pip install --no-cache-dir "litestar[standard]>=2.12" "httpx>=0.27"

# Static build first, then app.py last so a backend-only edit redoes just the tiny layer.
COPY --from=build /build/dist/app /app/static
COPY backend/app.py ./app.py

ENV ELEVATE_STATIC_DIR=/app/static
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
