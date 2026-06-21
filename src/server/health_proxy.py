from typing import Any
from typing import cast

import httpx
from litestar import Controller
from litestar import Request
from litestar import Response
from litestar import get
from litestar.datastructures import State

from server.config import Config

# The router authenticates requests; this app reads only query params, so the user/auth/state
# slots of the generic Request are unconstrained here.
AppRequest = Request[Any, Any, Any]


def provide_config(state: State) -> Config:
    return cast(Config, state.config)


def provide_http_client(state: State) -> httpx.AsyncClient:
    return cast(httpx.AsyncClient, state.http_client)


async def _proxy_get(
    client: httpx.AsyncClient, config: Config, path: str, params: dict[str, str] | None = None
) -> Response[str]:
    resp = await client.get(
        f"{config.health_service_base_url}{path}",
        params=params,
        headers={"Authorization": f"Bearer {config.app_token}"},
    )
    return Response(content=resp.text, media_type="application/json", status_code=resp.status_code)


class HealthProxyController(Controller):
    """Forwards the browser app's data reads to the health-data service, injecting the app token so
    the browser never handles cross-app credentials (same pattern as the health-dashboard app)."""

    path = "/api"

    @get("/workouts")
    async def workouts(self, request: AppRequest, http_client: httpx.AsyncClient, config: Config) -> Response[str]:
        return await _proxy_get(http_client, config, "/v1/workouts", dict(request.query_params))

    @get("/workouts/{workout_id:str}")
    async def workout_detail(self, workout_id: str, http_client: httpx.AsyncClient, config: Config) -> Response[str]:
        return await _proxy_get(http_client, config, f"/v1/workouts/{workout_id}")

    @get("/metrics")
    async def metrics(self, http_client: httpx.AsyncClient, config: Config) -> Response[str]:
        return await _proxy_get(http_client, config, "/v1/metrics")

    @get("/time-series")
    async def time_series(self, request: AppRequest, http_client: httpx.AsyncClient, config: Config) -> Response[str]:
        return await _proxy_get(http_client, config, "/v1/time-series", dict(request.query_params))
