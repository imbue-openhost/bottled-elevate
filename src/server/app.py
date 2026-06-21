from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import attr
import httpx
from litestar import Litestar
from litestar import get
from litestar.datastructures import State
from litestar.di import Provide
from litestar.static_files import create_static_files_router

from server.config import load_config
from server.health_proxy import HealthProxyController
from server.health_proxy import provide_config
from server.health_proxy import provide_http_client
from server.store import RecordStore
from server.store_controller import StoreController
from server.store_controller import provide_record_store


@attr.s(auto_attribs=True, frozen=True)
class HealthStatus:
    status: str


@get("/health", sync_to_thread=False)
def health() -> HealthStatus:
    return HealthStatus(status="ok")


def create_app() -> Litestar:
    config = load_config()
    store = RecordStore(config.sqlite_path)

    @asynccontextmanager
    async def http_client_lifespan(app: Litestar) -> AsyncIterator[None]:
        client = httpx.AsyncClient(timeout=30.0)
        app.state.http_client = client
        try:
            yield
        finally:
            await client.aclose()

    return Litestar(
        route_handlers=[
            health,
            StoreController,
            HealthProxyController,
            # Static SPA last; explicit /health and /api/* routes are matched by path so they win.
            create_static_files_router(path="/", directories=[config.static_dir], html_mode=True),
        ],
        state=State({"record_store": store, "config": config}),
        dependencies={
            "record_store": Provide(provide_record_store, sync_to_thread=False),
            "http_client": Provide(provide_http_client, sync_to_thread=False),
            "config": Provide(provide_config, sync_to_thread=False),
        },
        lifespan=[http_client_lifespan],
    )


app = create_app()
