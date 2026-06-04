# ---- Stage 1: build the Angular web app ----
FROM node:20-bookworm AS build
WORKDIR /build

# Root package.json is read by @elevate/shared (app-package.ts) at ../../../../package.json
COPY package.json ./
COPY appcore ./appcore

RUN cd appcore \
    && npm ci \
    && npm run build -- --configuration=web-prod
# Output: /build/dist/app

# ---- Stage 2: serve static build + proxy the health-data service ----
FROM python:3.12-slim AS serve
WORKDIR /app

RUN pip install --no-cache-dir "litestar[standard]>=2.12" "httpx>=0.27"

COPY backend/app.py ./app.py
COPY --from=build /build/dist/app /app/static

ENV ELEVATE_STATIC_DIR=/app/static
EXPOSE 8080
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
