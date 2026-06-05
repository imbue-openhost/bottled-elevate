"""Backend for the OpenHost Elevate web app.

Serves the static Angular build and proxies /api/* to the health-data service
(injecting OPENHOST_APP_TOKEN), so the browser app reaches health data the same
way the health-dashboard app does.
"""

import logging
import os

import httpx
from litestar import Litestar, Request, get
from litestar.response import Response
from litestar.static_files import create_static_files_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger(__name__)

STATIC_DIR = os.environ.get("ELEVATE_STATIC_DIR", "/app/static")
SERVICE_SHORTNAME = os.environ.get("ELEVATE_HEALTH_SHORTNAME", "health")

_http_client: httpx.AsyncClient | None = None


def _service_base_url() -> str:
    router_url = os.environ.get("OPENHOST_ROUTER_URL", "").rstrip("/")
    return f"{router_url}/api/services/v2/call/{SERVICE_SHORTNAME}"


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {os.environ.get('OPENHOST_APP_TOKEN', '')}"}


async def _service_get(path: str, params: dict | None = None) -> httpx.Response:
    assert _http_client is not None
    return await _http_client.get(f"{_service_base_url()}{path}", params=params, headers=_auth_headers())


def _proxy_response(resp: httpx.Response) -> Response:
    return Response(content=resp.text, media_type="application/json", status_code=resp.status_code)


@get("/health")
async def health_check() -> dict:
    return {"status": "ok"}


@get("/api/workouts")
async def proxy_workouts(request: Request) -> Response:
    return _proxy_response(await _service_get("/v1/workouts", dict(request.query_params)))


@get("/api/workouts/{workout_id:str}")
async def proxy_workout_detail(workout_id: str) -> Response:
    return _proxy_response(await _service_get(f"/v1/workouts/{workout_id}"))


@get("/api/metrics")
async def proxy_metrics() -> Response:
    return _proxy_response(await _service_get("/v1/metrics"))


@get("/api/time-series")
async def proxy_time_series(request: Request) -> Response:
    return _proxy_response(await _service_get("/v1/time-series", dict(request.query_params)))


async def on_startup() -> None:
    global _http_client
    _http_client = httpx.AsyncClient(timeout=30)


async def on_shutdown() -> None:
    global _http_client
    if _http_client:
        await _http_client.aclose()
        _http_client = None


app = Litestar(
    route_handlers=[
        health_check,
        proxy_workouts,
        proxy_workout_detail,
        proxy_metrics,
        proxy_time_series,
        # Static SPA last so explicit /api and /health routes win; html_mode serves index.html at "/".
        create_static_files_router(path="/", directories=[STATIC_DIR], html_mode=True),
    ],
    on_startup=[on_startup],
    on_shutdown=[on_shutdown],
)
