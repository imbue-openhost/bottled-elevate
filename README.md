# openhost-elevate

A fork of [Elevate](https://github.com/thomaschampagne/elevate) (fitness analytics) stripped down to run as a single-user web app on [OpenHost](https://github.com/imbue-ai/openhost). Instead of syncing from Strava or local files, it pulls workout data from the OpenHost **health-data service** (provided by apps like `apple-health` / `oura`).

## Architecture

```
 health-data providers (apple-health, oura …)
        │  service mesh
        ▼
 ┌─ elevate container ───────────────────────────────────┐
 │  backend/app.py  (Litestar)                            │
 │    • serves the static Angular build                   │
 │    • proxies /api/* → health-data service              │
 │      (injects OPENHOST_APP_TOKEN)                      │
 │                                                        │
 │  appcore  (Angular SPA, "web" build target)            │
 │    • WebSyncService → GET /api/workouts                │
 │    • maps spec.Workout → elevate Activity (+streams)   │
 │    • stores in browser IndexedDB                       │
 │    • views: activities, fitness-trend, year-progress,  │
 │      zones, athlete-settings, activity detail          │
 └────────────────────────────────────────────────────────┘
```

The health-data service is the source of truth; the browser IndexedDB is a local working copy synced from it. Auth is handled by the OpenHost router (the compute-space owner), so the app is single-user.

## Layout

| Path | What |
|------|------|
| `appcore/` | the Angular app (`@elevate/shared` lives in `appcore/modules/shared`) |
| `appcore/src/app/shared/.../web-*` | the web build target: sync, data-store, services, target/boot modules |
| `appcore/src/app/shared/services/sync/impl/web-activity-mapper.ts` | spec.Workout → elevate Activity + (mock) streams |
| `appcore/src/app/activity-detail/` | single-activity view (graph, map, peaks, time-in-zones) |
| `backend/` | Litestar app: serves the build + proxies the health-data service |
| `Dockerfile` | multi-stage: Node builds `appcore`, Python serves it |
| `openhost.toml` | manifest; consumes `health-data-service-spec` |

## Develop

```bash
# Build the web app (output: dist/app)
cd appcore && npm ci && npm run build -- --configuration=web      # dev
                        npm run build -- --configuration=web-prod  # AOT/minified

# Tests
node node_modules/jest/bin/jest.js

# Run the backend against a build (serves SPA + proxies /api/*)
cd backend && ELEVATE_STATIC_DIR=../dist/app uvicorn app:app --port 8080
```

`/api/*` only works inside OpenHost (it needs `OPENHOST_ROUTER_URL` + `OPENHOST_APP_TOKEN`); locally those routes 500, but the SPA still serves.

## Deploy on OpenHost

```bash
oh app deploy <git-url> --name elevate --instance <instance>
oh app reload elevate --update --wait --instance <instance>   # after pushes
oh app logs elevate --instance <instance>
```

The manifest consumes `github.com/imbue-openhost/health-data-service-spec` (shortname `health`). At least one provider app (e.g. `apple-health`) must be installed for data to appear.

## Outstanding / come back to

- **Workout streams are mocked.** Providers currently expose only sparse summaries (duration / distance / calories — no per-second data). `web-activity-mapper.ts::buildMockStreams()` synthesizes deterministic HR/speed/altitude/cadence/watts/GPS so the activity-detail charts render. Replace with real streams once providers serve them, and enrich `apple-health`/`oura` to expose HR/GPS/power.
- **Summary stat panels are sparse.** Activities carry summary metrics but `stats` isn't recomputed from streams (no compute worker on web). `WebActivityService.recalculateSingle` just re-persists; it could run `ActivityComputer` over the streams to populate power/HR/zones/scores.
- **Best-splits is empty.** `WebActivityService.computeSplit` returns `[]` (was an Electron-main calc). Could be reimplemented client-side.
- **Map needs a token.** `environment.mapBoxToken` is empty → the activity map disables itself (rest of the view still renders). Set a Mapbox token to enable tiles.
- **`buildTarget` reuses `EXTENSION`.** A real `BuildTarget.WEB` was avoided because `@elevate/shared` switches on the enum in ~30 places. Formalizing it would allow web-specific settings/columns.
- **Cosmetic naming.** A few generic browser shell components/services are still named `extension-*` (top-bar, window, menu-items, splash, update-bar, recalculate-bar, app-more-menu, load service, error handler). Functional; rename to neutral/`web-*` for clarity.
- **No backup/restore on web** (the health-data service is the source of truth; re-sync rebuilds the local store).
- **Not yet exercised in a real browser / deployed.** Builds and unit tests pass; a live sync + UI smoke test against an instance is still pending.

## License

MPL-2.0 (inherited from upstream Elevate).
